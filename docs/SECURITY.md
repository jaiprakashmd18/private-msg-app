# Security

This document explains every security control, how it works, how it is tested, and what the app does **not** protect against.

## 1. Controls and how each one is tested

Automated test files: `tests/db/security.test.ts` (database, 39 tests), `tests/integration/supabase.test.ts` (live Supabase stack), `tests/integration/api.test.ts` (live app), `tests/unit/*`.

| # | Requirement | Mechanism | Automated test |
| --- | --- | --- | --- |
| 1 | Only approved Google accounts can create an account | Auth hook `before_user_created_hook` + `BEFORE INSERT` trigger on `auth.users` (`enforce_allowlist_on_signup`), emails compared lower-cased | db: *rejects a Google account whose email is not approved*, *auth hook rejects…*, *matches emails case-insensitively* |
| 2 | No bypass via email/password, magic link, phone or anonymous sign-up, even for an approved email | Trigger and hook accept only `provider = google`; email/phone providers disabled in config; also blocks the service-role admin API | db: *rejects non-Google sign-ups…*; integration: *refuses email/password sign-up…*, *refuses non-Google accounts even when created with the service-role admin API* |
| 3 | Sign-in refusals are clear but leak nothing | `/auth/callback` maps Auth refusals to `/login?error=not_authorized\|no_access\|failed` | api: *sends refused Google sign-ins back to the login page with a reason* |
| 4 | Approval can't be raced | Allowlist row locked `FOR SHARE` inside the sign-up transaction | (by construction; covered by #1 tests) |
| 5 | Revocation is immediate, including existing sessions | RLS calls `private.is_active_user()` on every query; `admin_set_access_status` deletes `auth.sessions` (refresh tokens); `custom_access_token_hook` refuses new/refreshed tokens | db: *disabling an email cuts off an existing session immediately…*, *access-token hook refuses tokens for disabled or unknown users*; integration: *revoking access cuts off an existing session immediately* (same JWT) |
| 6 | Users read only their own conversations/messages | RLS: active user AND `is_conversation_member()` | db: *outsiders cannot read another pair's messages*; integration: *does not deliver realtime events or REST reads to outsiders* |
| 7 | Users send only to their own conversations | `send_message` checks membership + other party still active | db: *outsiders cannot send…*, *A cannot keep sending to a revoked participant* |
| 8 | Users can't add themselves to conversations or write tables directly | No INSERT/UPDATE/DELETE grants on chat tables; writes only via RPCs | db: *users cannot add themselves to a conversation or insert messages directly* |
| 9 | Users can't make themselves admin or approve their own email | No write grants on `authorized_emails`; `profiles` only `display_name`, `bio` updatable (column grants); users can't change their account email (trigger); admin RPCs check `private.is_admin()` | db: *members cannot read or modify the allowlist*, *…grant themselves admin…*, *does not let a user change the email on their account*; integration: *prevents self-promotion…* |
| 10 | Admin rights come only from the DB owner | `role` changed only via SQL; admin entries immutable from dashboard | db: *admins cannot change administrator entries from the dashboard*, *a disabled admin loses admin rights* |
| 11 | Audit logs are tamper-resistant | No client write grants; only SECURITY DEFINER functions insert | db: *audit logs cannot be written or altered directly, even by admins* |
| 12 | Admin access to message content is explicit and audited | RPC only works when the policy is on; writes `admin.messages_viewed`; members see a banner | db: *admins cannot read message content unless the policy is enabled, and reads are audited* |
| 13 | Attachments limited to members | Storage RLS on folder `<conversation>/<uploader>/…`; reads require an attachment row; bucket size + MIME limits | db: 4 attachment tests; integration: *enforces attachment storage policies* (spoofed folder, outsider upload, HTML upload, outsider signed URL) |
| 14 | Realtime obeys access policy | Postgres Changes applies SELECT RLS per subscriber | integration: *delivers messages in real time…*, *does not deliver realtime events… to outsiders* |
| 15 | Input validation and size limits | zod on the client/server + DB `CHECK`s + RPC validation (4000 chars, 5 files, 10 MB) | db: *validates message input*; unit: `validation.test.ts` |
| 16 | Duplicate-safe retries | `unique (sender_id, client_id)` + idempotent `send_message` | db + integration: *deduplicates retried sends* |
| 17 | Abuse limits | Sign-in throttling and bot protection are handled by Google and Supabase Auth's built-in rate limits; messages: 15 per 10 s per sender | db: *rate-limits message floods* |
| 18 | CSRF on cookie-authenticated routes | `assertSameOrigin` on all POST/DELETE route handlers; cookies `SameSite=Lax` | unit: *same-origin (CSRF) check*; api: *rejects … cross-site requests* |
| 19 | Secrets never reach the browser | Service key only in `env.server.ts` (`server-only` import guard), never `NEXT_PUBLIC_` | build fails if imported client-side |
| 20 | Security headers | CSP (`frame-ancestors 'none'`, connect only to self + Supabase), HSTS, nosniff, no-referrer | api: *sends security headers* |
| 21 | No sensitive logging | Tokens never logged; audit stores masked emails; server error logs truncate messages and omit bodies | code review (`lib/errors.ts`) |
| 22 | Push notifications can't be abused | Devices register via `save_push_subscription` (own account, active users only); `server_push_targets` returns devices only for the real sender's undeleted message from the last 10 minutes, once per message, and only for other **active** members; VAPID keys live in the non-exposed `private` schema | db: *push notifications* tests (5); unit: `push.test.ts`, `service-worker.test.ts` |

### How the RLS tests work

`tests/db/helpers.ts → asUser()` opens a transaction, `SET LOCAL ROLE authenticated` and sets `request.jwt.claims` to `{"sub": "<user id>"}` — exactly what PostgREST does for a real API request. So each test runs the real policies, grants and functions. The suite runs against a throwaway PostgreSQL with `tests/db/supabase-shim.sql` (in CI) **and** against the real Supabase Postgres from `supabase start` (`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres SKIP_MIGRATIONS=1 npm run test:db`).

## 2. Encryption — what is and isn't protected

| Layer | Status | Notes |
| --- | --- | --- |
| **In transit** | ✅ | HTTPS/TLS to Vercel and Supabase; Realtime over WSS. HSTS header set. |
| **At rest** | ✅ (provider) | Supabase encrypts database and storage disks at rest (AES-256). This protects against stolen disks, **not** against anyone with database access. |
| **Access control** | ✅ | RLS + RPC checks + storage policies (above). This is the main protection between users. |
| **End-to-end encryption** | ❌ **Not implemented** | The server (and anyone with database-owner access to your Supabase project) can read message bodies and files. |

### Path to end-to-end encryption

The schema is ready for it without exposing plaintext:

1. Generate a key pair per device in the browser (e.g. libsodium / WebCrypto X25519); store only **public** keys in a new `device_keys` table (RLS: readable by conversation partners).
2. Encrypt the body client-side and store ciphertext in `messages.body` (raise the length limit to fit base64). Encrypt files before upload.
3. Disable server-side features that need plaintext: `search_vector`/`search_messages` (replace with on-device search), `admin_read_conversation_messages`, server-side trimming in `send_message`.
4. Prefer an audited protocol (Signal's Double Ratchet via a maintained library, or MLS) over a home-grown scheme; plan for multi-device key distribution and key verification UX.

Do not advertise the app as end-to-end encrypted until that is implemented and reviewed.

## 3. Known limitations and residual risks

- **Security depends on each member's Google account.** Anyone who controls an approved Google account can sign in as that member. Members should turn on 2-Step Verification in their Google account.
- **Existing access tokens stay cryptographically valid until expiry** (default 1 hour) after revocation. They are useless — RLS denies every read/write and Realtime stops delivering — but tune *Auth → JWT expiry* lower if you want them to expire sooner.
- **Member directory:** active members can see each other's names and email addresses (needed to start conversations).
- **Infrastructure owners** (whoever controls the Supabase project) can read all data regardless of the in-app admin policy.
- **Backups** retain deleted messages until the backup expires.
- **CSP** allows inline scripts because Next.js injects inline bootstrap scripts; switch to nonce-based CSP if you need stricter XSS hardening. All message content is rendered as text (React escapes it); there is no HTML/Markdown rendering.
- **Edit history** is not kept; only the latest text and an "edited" marker.

- **Notification content travels through Google/Apple/Mozilla push services.** It is end-to-end encrypted to the device (Web Push encryption, RFC 8291), so those services can't read it, but they see that a notification was sent. The message preview appears on the lock screen unless the member turns *Show message text* off.
- **The service worker caches no messages or user data** — only a static offline page.

## 4. Secrets handling

- `.env.example` holds placeholders only; `.env*` files are git-ignored.
- `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are server-only (Vercel environment variables, never `NEXT_PUBLIC_`).
- If a secret leaks: rotate it in Supabase (Project Settings → API Keys) / regenerate, update Vercel env vars, redeploy.
