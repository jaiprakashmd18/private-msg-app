# Architecture

## 1. Overview

```
 Browser (Next.js client components)
   │  HTTPS: pages, /api/* route handlers           WSS: Supabase Realtime
   │  HTTPS: Supabase REST/RPC + Storage (user JWT, RLS applies)
   ▼
 Vercel (Next.js 16 server)                         Supabase
   • proxy.ts – refreshes session cookie, ──────►   • Auth (Sign in with Google)
     redirects signed-out users                        – before-user-created hook  ─┐
   • server layouts – check access in DB              – custom access token hook  ─┤ allowlist
   • /auth/callback – finishes Google sign-in,         • Postgres                    │
     routes by access                 – RLS on every table  ◄──────┘
   • /api/admin/* – the few service-role ops           – SECURITY DEFINER RPCs (all writes)
   • /api/cron/retention – daily purge                 – audit_logs (append-only)
                                                       • Realtime (postgres_changes, RLS-filtered)
                                                       • Storage bucket `attachments` (private, RLS)
```

**Key principle:** the browser talks to Supabase directly with the user's own JWT, and *the database decides* what that user may do. The Next.js server never acts as a privileged proxy for chat data. The service-role key is used server-side only for deleting auth users, deleting storage files, and the scheduled retention job.

## 2. File tree

```
.
├── .env.example                     # placeholders only
├── .github/workflows/ci.yml         # lint, typecheck, unit tests, build, DB security tests
├── next.config.ts                   # CSP and security headers
├── vercel.json                      # daily retention cron
├── public/                          # sw.js (push + offline page only), offline.html, icons/
├── public/sw.js, offline.html, icons/  # PWA: service worker (push + offline page only), app icons
├── scripts/test-db.sh               # runs the DB security suite (throwaway Postgres or given DB)
├── supabase/
│   ├── config.toml                  # local stack config: Google provider, auth hooks
│   ├── migrations/
│   │   ├── …0100_schema.sql             # tables, indexes, constraints
│   │   ├── …0200_access_control.sql     # allowlist enforcement, helpers, grants, RLS
│   │   ├── …0300_messaging.sql          # chat RPCs (send/edit/delete/read/search)
│   │   ├── …0400_admin.sql              # admin RPCs, retention, server-only functions
│   │   ├── …0500_storage_realtime.sql   # attachments bucket + policies, realtime publication
│   │   ├── …0600_access_token_hook.sql  # refuse tokens for non-active users
│   │   ├── …0700_push_notifications.sql # device subscriptions, notify-once rules
│   │   └── …0800_chat_features.sql      # groups, replies, reactions, thumbnails, voice, typing/online
│   ├── seed.sql                     # LOCAL ONLY example allowlist
│   └── snippets/create_first_admin.sql
├── src/
│   ├── proxy.ts                     # Next.js 16 "proxy" (formerly middleware)
│   ├── app/
│   │   ├── layout.tsx, globals.css, page.tsx, error.tsx, not-found.tsx, icon.svg
│   │   ├── login/                   # "Continue with Google" + error messages
│   │   ├── unauthorized/            # shown to signed-in users without access
│   │   ├── privacy/                 # public privacy notice
│   │   ├── (app)/layout.tsx         # requires an ACTIVE user (DB check)
│   │   ├── (app)/chat/              # inbox + conversation routes
│   │   ├── (app)/settings/          # profile, theme, privacy info, sessions
│   │   ├── (app)/admin/             # overview, users, conversations, audit, settings
│   │   └── api/
│   │       ├── auth/signout/route.ts
│   │       ├── admin/{users/[id],conversations/[id],retention}/route.ts
│   │       ├── push/{key,notify}/route.ts  # Web Push (VAPID key auto-created in DB)
│   │       ├── push/{key,notify}/route.ts  # Web Push (VAPID key auto-created in DB)
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
│   │   ├── validation.ts            # zod schemas
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
| `authorized_emails` | **The allowlist.** Lower-cased Google account email, label, `role` (`member`/`admin`), `status` (`active`/`disabled`). | `email` unique + format check. `role` is never writable through the API. |
| `profiles` | One per auth user: email, display name (from the label or Google profile), bio, last seen. `authorized_email_id` → allowlist. | PK = `auth.users.id` (cascade). Link set NULL when the email is removed. Only `display_name`, `bio` are user-updatable (column grants). |
| `conversations` | `kind = 'direct'`; `direct_key` = sorted member ids → one conversation per pair. | `direct_key` unique. |
| `conversation_members` | Membership + `last_delivered_at` / `last_read_at` watermarks. | PK (conversation, user). No client INSERT/UPDATE/DELETE. |
| `messages` | Body ≤ 4000 chars, `client_id` for idempotency, `edited_at`, `deleted_at` (soft delete), generated `search_vector`. | `unique (sender_id, client_id)`; index `(conversation_id, created_at desc, id desc)` for paging; GIN on `search_vector`. |
| `attachments` | Metadata for files in the `attachments` bucket. | Size ≤ 10 MB, `storage_path` unique, cascades with message. |
| `app_settings` | Single row: retention, audit retention, admin message access, attachments, edit window. | Bounded checks on every value. |
| `audit_logs` | Append-only security log (masked emails, no message content). | No client write grants at all. |

**Why receipts are watermarks, not a `message_receipts` table:** in 1:1 chats, "delivered/read up to time T" per member is equivalent to per-message receipts, needs one row per member instead of one per message, makes unread counts a single indexed range count, and generates one realtime event per read instead of one per message.

**Soft vs. hard deletion:** a user's "delete for everyone" wipes the body and keeps a tombstone so every device shows *"This message was deleted"*. Retention purges, account deletion and conversation deletion are hard deletes.

## 4. Authorization design

### Sign-up and sign-in (allowlist)

1. The login page calls `supabase.auth.signInWithOAuth({ provider: "google" })` (PKCE). The user picks a Google account; Google returns them to Supabase Auth, which redirects to `/auth/callback?code=…`.
2. Before Supabase Auth creates an account for a first-time user:
   - **`before_user_created_hook`** refuses anything that isn't a Google sign-in for an **active** allowlisted email;
   - **`enforce_allowlist_on_signup` trigger** on `auth.users` performs the same check inside the insert transaction (with `FOR SHARE` on the allowlist row, so approval can't be raced). This holds even if the hook isn't configured, and it also blocks email/password, magic-link, phone and anonymous users even when an admin enables those methods by mistake (or uses the service-role admin API);
   - **`custom_access_token_hook`** refuses to issue or refresh any token for a user whose email is not active.
3. `/auth/callback` exchanges the code for a session on the server, logs `auth.sign_in`, and redirects to `/chat` or `/unauthorized`. Refusals come back as `/login?error=not_authorized|no_access|failed` with a friendly message.
4. The session is stored in `SameSite=Lax` cookies managed by `@supabase/ssr`. They are intentionally readable by JavaScript (the browser Supabase client needs the access token for REST and Realtime), so XSS prevention (React escaping, no HTML rendering of messages, CSP) matters.
5. Users cannot change the email on their account (trigger), because the approved address *is* the identity.

### Every request

- `src/proxy.ts` validates/refreshes the session and redirects signed-out users (convenience only).
- `(app)/layout.tsx` calls `my_access()` in the database: inactive → `/unauthorized`. `admin/layout.tsx` additionally requires `role = 'admin'`.
- **RLS** on every table calls `private.is_active_user()` (allowlist re-check) and `private.is_conversation_member()`. This is what makes revocation immediate even for a still-valid JWT.
- **All writes go through SECURITY DEFINER RPCs** (`send_message`, `edit_message`, `admin_*`…). Clients have no INSERT/UPDATE/DELETE privileges on chat tables. Each RPC re-checks access and membership, validates input and writes audit entries where relevant.
- **Realtime** uses Postgres Changes, which evaluates the SELECT policy for each subscriber, so events only reach active members.
- **Storage** policies require active membership of the conversation folder; uploads only into `<conversation>/<own user id>/`; reads only for files attached to a message (or the uploader's own pending upload); bucket limits size and MIME types.

### Administrators

- Admin rights live in `authorized_emails.role`, which no API path can write. The first admin is created with SQL in the dashboard (`supabase/snippets/create_first_admin.sql`). Admin entries can't be disabled/removed from the dashboard either (prevents lock-out and admin-vs-admin abuse).
- Admins see metadata by default. Reading message content requires `app_settings.admin_can_read_messages = true`, works only through `admin_read_conversation_messages()`, writes an audit entry per view, and displays a notice to every member while enabled.

## 5. Messaging flow

1. Composer → optimistic bubble (`client_id = crypto.randomUUID()`).
2. Files upload to Storage first (paths remembered per `client_id`, so a retry doesn't re-upload).
3. `send_message(conversation, client_id, body, attachments)` inserts atomically; attachment size/type are read from Storage's own metadata, not the client.
4. Realtime `INSERT` reaches the other member (RLS-filtered); their client fetches the full row (with attachments), marks it delivered, and — if the conversation is open and visible — read.
5. Receipt watermark updates arrive via Realtime on `conversation_members`, turning ✓ into ✓✓ and then blue ✓✓.
6. On reconnect / tab focus / channel (re)subscribe, the client fetches anything newer than its last message.

## 7. Installable app and push notifications

- `src/app/manifest.ts` + `public/icons/*` make the site installable (standalone display, start at `/chat`). `public/sw.js` is registered on every page; it serves `offline.html` when a page load fails and displays pushes. It caches no user data.
- Turning notifications on (Settings) asks permission, subscribes with the server's VAPID public key (`/api/push/key`) and stores the subscription with `save_push_subscription`.
- After a message is saved, the sender's app calls `/api/push/notify`. The route takes the sender from the session and asks `server_push_targets` (service role) for recipient devices; the database enforces "real sender, recent, once, active recipients only". Payloads are encrypted per device by `web-push`; expired subscriptions (404/410) are deleted.
- The service worker skips the notification if that exact conversation is open and focused; tapping a notification focuses an open window or opens the chat. The installed app's icon shows the unread total (Badging API, where supported).

## 8. Groups, replies, reactions, media, typing and online

- **Groups** are `conversations.kind = 'group'` with a `title`; `conversation_members` gains `is_admin` and `left_at` (soft removal). Group events are stored as messages with `system_event` (e.g. `{"type":"member_added","user_id":…}`) and rendered as centered notes. Read receipts in groups use the *minimum* watermark of the other members, so ✓✓ blue means everyone has read it.
- **Replies** use `messages.reply_to_id` (same conversation enforced); the client embeds the quoted message with `reply_to:reply_to_id(...)`.
- **Reactions** live in `message_reactions` (one per person per message; NULL emoji = removed) and stream via Postgres Changes.
- **Photos** are processed in the browser (`src/lib/media.ts`): decoded, resized to ≤2048 px when large, and a ≤480 px JPEG thumbnail is uploaded next to the original (`attachments.thumb_path`, `width`, `height`). The chat shows thumbnails; the lightbox loads the full photo.
- **Voice notes** use `MediaRecorder` (MP4/AAC preferred for iPhone playback, WebM/Opus otherwise) and store `duration_ms`.
- **Typing** is a Broadcast on the private channel `conv:<id>`; **online** is Presence on the private channel `online`; "last seen" comes from a 60-second `heartbeat()` RPC. Channel access is enforced by RLS policies on `realtime.messages`.
