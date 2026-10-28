# Architecture

## 1. Overview

```
 Browser (Next.js client components)
   │  HTTPS: pages, /api/* route handlers           WSS: Supabase Realtime
   │  HTTPS: Supabase REST/RPC + Storage (user JWT, RLS applies)
   ▼
 Vercel (Next.js 16 server)                         Supabase
   • proxy.ts – refreshes session cookie, ──────►   • Auth (phone OTP via Twilio etc.)
     redirects signed-out users                        – before-user-created hook  ─┐
   • server layouts – check access in DB              – custom access token hook  ─┤ allowlist
   • /api/auth/* – OTP request/verify with             • Postgres                    │
     rate limits + allowlist pre-check                 – RLS on every table  ◄──────┘
   • /api/admin/* – the few service-role ops           – SECURITY DEFINER RPCs (all writes)
   • /api/cron/retention – daily purge                 – audit_logs (append-only)
                                                       • Realtime (postgres_changes, RLS-filtered)
                                                       • Storage bucket `attachments` (private, RLS)
```

**Key principle:** the browser talks to Supabase directly with the user's own JWT, and *the database decides* what that user may do. The Next.js server never acts as a privileged proxy for chat data. The service-role key is used server-side only for: the OTP allowlist pre-check and rate limiting, deleting auth users, deleting storage files, and the scheduled retention job.

## 2. File tree

```
.
├── .env.example                     # placeholders only
├── .github/workflows/ci.yml         # lint, typecheck, unit tests, build, DB security tests
├── next.config.ts                   # CSP and security headers
├── vercel.json                      # daily retention cron
├── scripts/test-db.sh               # runs the DB security suite (throwaway Postgres or given DB)
├── supabase/
│   ├── config.toml                  # local stack config: phone auth, test OTPs, auth hooks
│   ├── migrations/
│   │   ├── …0100_schema.sql             # tables, indexes, constraints
│   │   ├── …0200_access_control.sql     # allowlist enforcement, helpers, grants, RLS
│   │   ├── …0300_messaging.sql          # chat RPCs (send/edit/delete/read/search)
│   │   ├── …0400_admin.sql              # admin RPCs, retention, server-only functions
│   │   ├── …0500_storage_realtime.sql   # attachments bucket + policies, realtime publication
│   │   └── …0600_access_token_hook.sql  # refuse tokens for non-active users
│   ├── seed.sql                     # LOCAL ONLY test numbers
│   └── snippets/create_first_admin.sql
├── src/
│   ├── proxy.ts                     # Next.js 16 "proxy" (formerly middleware)
│   ├── app/
│   │   ├── layout.tsx, globals.css, page.tsx, error.tsx, not-found.tsx, icon.svg
│   │   ├── login/                   # phone → OTP screens
│   │   ├── unauthorized/            # shown to signed-in users without access
│   │   ├── privacy/                 # public privacy notice
│   │   ├── (app)/layout.tsx         # requires an ACTIVE user (DB check)
│   │   ├── (app)/chat/              # inbox + conversation routes
│   │   ├── (app)/settings/          # profile, theme, privacy info, sessions
│   │   ├── (app)/admin/             # overview, users, conversations, audit, settings
│   │   └── api/
│   │       ├── auth/{otp,verify,signout}/route.ts
│   │       ├── admin/{users/[id],conversations/[id],retention}/route.ts
│   │       └── cron/retention/route.ts
│   ├── components/
│   │   ├── ui/                      # shadcn/ui-style primitives (Radix based)
│   │   ├── auth/, chat/, admin/, settings/
│   │   └── app-provider.tsx         # session/access context + error reporting
│   ├── hooks/use-conversation-messages.ts   # paging, optimistic send, retry, realtime merge
│   ├── lib/
│   │   ├── supabase/{client,server,admin,proxy}.ts
│   │   ├── data/chat.ts             # all chat data access (RPC/REST/Storage)
│   │   ├── env.ts, env.server.ts    # zod-validated environment
│   │   ├── validation.ts, phone.ts  # zod schemas, E.164 normalization
│   │   ├── errors.ts                # centralized error mapping
│   │   ├── access.ts, admin-route.ts, http.ts, rate-limit.ts, storage.server.ts
│   │   └── format.ts, constants.ts, utils.ts
│   └── types/app.ts
└── tests/
    ├── unit/                        # vitest, no network
    ├── db/                          # 39 RLS/RPC tests via raw Postgres roles + JWT claims
    └── integration/                 # supabase-js against a live local stack; HTTP tests of the app
```

## 3. Database schema

| Table | Purpose | Notable constraints |
| --- | --- | --- |
| `authorized_phone_numbers` | **The allowlist.** E.164 number, label, `role` (`member`/`admin`), `status` (`active`/`disabled`). | `phone_e164` unique + format check. `role` is never writable through the API. |
| `profiles` | One per auth user: phone, display name, bio, last seen. `authorized_phone_id` → allowlist. | PK = `auth.users.id` (cascade). Link set NULL when the number is removed. Only `display_name`, `bio` are user-updatable (column grants). |
| `conversations` | `kind = 'direct'`; `direct_key` = sorted member ids → one conversation per pair. | `direct_key` unique. |
| `conversation_members` | Membership + `last_delivered_at` / `last_read_at` watermarks. | PK (conversation, user). No client INSERT/UPDATE/DELETE. |
| `messages` | Body ≤ 4000 chars, `client_id` for idempotency, `edited_at`, `deleted_at` (soft delete), generated `search_vector`. | `unique (sender_id, client_id)`; index `(conversation_id, created_at desc, id desc)` for paging; GIN on `search_vector`. |
| `attachments` | Metadata for files in the `attachments` bucket. | Size ≤ 10 MB, `storage_path` unique, cascades with message. |
| `app_settings` | Single row: retention, audit retention, admin message access, attachments, edit window. | Bounded checks on every value. |
| `audit_logs` | Append-only security log (masked phones, no message content). | No client write grants at all. |
| `private.rate_limits` | Fixed-window counters for OTP endpoints (HMAC'd keys). | In the non-exposed `private` schema. |

**Why receipts are watermarks, not a `message_receipts` table:** in 1:1 chats, "delivered/read up to time T" per member is equivalent to per-message receipts, needs one row per member instead of one per message, makes unread counts a single indexed range count, and generates one realtime event per read instead of one per message.

**Soft vs. hard deletion:** a user's "delete for everyone" wipes the body and keeps a tombstone so every device shows *"This message was deleted"*. Retention purges, account deletion and conversation deletion are hard deletes.

## 4. Authorization design

### Sign-up and sign-in (allowlist)

1. User enters a number → `POST /api/auth/otp`:
   same-origin check → zod/E.164 validation → rate limits (per IP 20/h, per number 5/h and 1/min, in Postgres) → `server_phone_is_authorized()` → only then `signInWithOtp`. The response is **identical** for approved and unapproved numbers (no allowlist enumeration).
2. Even if someone calls the Supabase Auth API directly with the public key:
   - **`before_user_created_hook`** rejects unapproved numbers before an account exists or an SMS is sent;
   - **`enforce_allowlist_on_signup` trigger** on `auth.users` performs the same check inside the insert transaction (with `FOR SHARE` on the allowlist row, so approval can't be raced) — this holds even if the hook isn't configured;
   - **`custom_access_token_hook`** refuses to issue or refresh any token for a user whose number is not active.
3. `POST /api/auth/verify` verifies the code server-side with its own brute-force limits. The session is stored in `SameSite=Lax` cookies managed by `@supabase/ssr`. They are intentionally readable by JavaScript (the browser Supabase client needs the access token for REST and Realtime), so XSS prevention — React escaping, no HTML rendering of messages, CSP — matters.

### Every request

- `src/proxy.ts` validates/refreshes the session and redirects signed-out users (convenience only).
- `(app)/layout.tsx` calls `my_access()` in the database: inactive → `/unauthorized`. `admin/layout.tsx` additionally requires `role = 'admin'`.
- **RLS** on every table calls `private.is_active_user()` (allowlist re-check) and `private.is_conversation_member()`. This is what makes revocation immediate even for a still-valid JWT.
- **All writes go through SECURITY DEFINER RPCs** (`send_message`, `edit_message`, `admin_*`…). Clients have no INSERT/UPDATE/DELETE privileges on chat tables. Each RPC re-checks access and membership, validates input and writes audit entries where relevant.
- **Realtime** uses Postgres Changes, which evaluates the SELECT policy for each subscriber, so events only reach active members.
- **Storage** policies require active membership of the conversation folder; uploads only into `<conversation>/<own user id>/`; reads only for files attached to a message (or the uploader's own pending upload); bucket limits size and MIME types.

### Administrators

- Admin rights live in `authorized_phone_numbers.role`, which no API path can write. The first admin is created with SQL in the dashboard (`supabase/snippets/create_first_admin.sql`). Admin entries can't be disabled/removed from the dashboard either (prevents lock-out and admin-vs-admin abuse).
- Admins see metadata by default. Reading message content requires `app_settings.admin_can_read_messages = true`, works only through `admin_read_conversation_messages()`, writes an audit entry per view, and displays a notice to every member while enabled.

## 5. Messaging flow

1. Composer → optimistic bubble (`client_id = crypto.randomUUID()`).
2. Files upload to Storage first (paths remembered per `client_id`, so a retry doesn't re-upload).
3. `send_message(conversation, client_id, body, attachments)` inserts atomically; attachment size/type are read from Storage's own metadata, not the client.
4. Realtime `INSERT` reaches the other member (RLS-filtered); their client fetches the full row (with attachments), marks it delivered, and — if the conversation is open and visible — read.
5. Receipt watermark updates arrive via Realtime on `conversation_members`, turning ✓ into ✓✓ and then blue ✓✓.
6. On reconnect / tab focus / channel (re)subscribe, the client fetches anything newer than its last message.
