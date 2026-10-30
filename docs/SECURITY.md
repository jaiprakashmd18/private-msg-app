# Security

This document explains every security control, how it works, how it is tested, and what the app does **not** protect against.

## 1. Controls and how each one is tested

Automated test files: `tests/db/security.test.ts` (database, 80 tests: `security.test.ts`, `couple.test.ts`), `tests/integration/supabase.test.ts` (live Supabase stack), `tests/integration/api.test.ts` (live app), `tests/unit/*`.

| # | Requirement | Mechanism | Automated test |
| --- | --- | --- | --- |
| 1 | Only approved emails can create an account | Auth hook `before_user_created_hook` + `BEFORE INSERT` trigger on `auth.users` (`enforce_allowlist_on_signup`), emails compared lower-cased | db: *rejects a Google account whose email is not approved*, *auth hook rejects…*, *matches emails case-insensitively* |
| 2 | No self-service sign-up by password, magic link, phone or anonymous, even for an approved email | The `auth.users` trigger accepts `google`, or `email` only with a one-time grant that `admin_prepare_password` (admin-only) leaves for that exact email for 60 seconds, consumed on use; phone/anonymous always refused | db: *rejects self-service sign-ups…*, *accepts a new password account only right after an admin prepared it, once*, *an expired grant doesn't work*; integration: *refuses email/password sign-up…*, *refuses password accounts from the service-role admin API unless an admin prepared them* |
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
| 23 | Groups: only members read/send; only group admins add, remove, rename or promote; removal is immediate | `is_conversation_member()` now means *current* member (`left_at is null`); `create_group`, `add_group_members`, `remove_group_member`, `rename_group`, `set_group_admin` check `is_group_admin()`; members are soft-removed so realtime never broadcasts unfiltered DELETEs; groups always keep an admin | db: *group chats* (7 tests); e2e: removed member sees "Conversation unavailable" |
| 24 | Replies and reactions stay inside the conversation | `send_message` rejects a `reply_to` from another conversation; `toggle_reaction` requires membership; reactions are readable only by members; "removing" a reaction is an UPDATE (RLS-filtered) | db: *replies and reactions* (2) ; integration: *reactions arrive in real time* |
| 25 | Typing and online signals are private | Private Realtime channels `conv:<id>` (members only) and `online` (active users only), enforced by RLS on `realtime.messages`; receivers map user ids to names themselves, so names can't be spoofed | integration: *typing signals … reach members only* (outsider refused), *online presence* |
| 26 | Photo thumbnails and voice notes obey attachment rules | Thumbnails must be the sender's own upload in the same conversation folder; readable only like their attachment; sizes/durations validated; bucket accepts only listed image/audio/document types | db: *photos, thumbnails and voice notes* (3) |
| 27 | Access requests can't be used to get in or to flood the admin | Requests are recorded only by the sign-up hook, only for Google-verified emails, and create **no** account; only `admin_accept_request` (admin-only, audited) adds the email to the allowlist; table readable by admins only; at most 500 pending requests; https-only picture URLs | db: *access requests* (4) |
| 28 | Profile and group photos | Private `avatars` bucket (2 MB, JPEG/PNG/WebP); members write only `users/<own id>/`, only group admins write `groups/<conversation>/`; reads for active members only; `set_avatar`/`set_group_avatar` accept only paths in the caller's own folder | db: *profile and group photos* (3) |
| 29 | Password accounts | Created/reset only through `/api/admin/allowlist/[id]/password` (same-origin, active admin, never for admin entries or disabled emails); random 12-character temporary password (~68 bits) returned once with `no-store`; Supabase Auth stores a bcrypt hash; `my_access().must_change_password` (hash still equals the admin-set one) sends the member to `/set-password` before anything else; a reset revokes all their sessions; audited. Password sign-in goes from the browser straight to Supabase Auth, so its per-IP rate limits apply per person. The access-token hook refuses tokens for disabled emails exactly as for Google | db: *password sign-in* (3); integration: *signs in with an administrator-set password…*; unit: `password.test.ts` |
| 30 | View-once photos | Only in one-to-one chats, alone, without caption or thumbnail; Storage read policy denies everyone (the sender too) except the recipient for 1 minute after `open_view_once()` marks it opened; `/api/view-once/[id]` deletes the file (service role, only for the person who opened it); retention job removes leftovers; notifications say only "View-once photo" | db: *view-once photos* (3); e2e |
| 31 | Taps, dates, list, love notes | All writes through SECURITY DEFINER RPCs that check current membership; tables readable only by members (love notes only by their author until delivered); soft deletes so Realtime never broadcasts unfiltered DELETEs; rate limit on hearts (3 / 10 s, 60 / hour); caps (50 dates, 50 waiting notes, 300 list items) | db: *thinking of you*, *special dates* (2), *love notes for later* (2), *shared list* |
| 32 | Timed delivery can't be abused | Love notes are delivered exactly once (`FOR UPDATE SKIP LOCKED` + the `(sender, client_id)` unique key), only while the author and the other person still have access (otherwise cancelled); any member's open app may trigger delivery, but messages always come from their real author | db: *love notes…* |
| 33 | Notification hook | `/api/push/hook` requires the secret stored in the private schema (constant-time compare); it can only ask for notifications the database allows: timed messages, once each. `server_push_targets` lets only a message's sender request its notification, except timed messages (any current member or the hook) | db: *app address for timed notifications*, push-target checks in *thinking of you* / *love notes*; unit: `push.test.ts` |
| 34 | Chat look | Wallpaper must be the caller's own file in `avatars/users/<uid>/`; colours from a fixed list | db: *chat wallpaper and colours* |
| 35 | App lock | Device-only privacy screen: PIN stored as a salted PBKDF2-SHA-256 hash (210 000 iterations), constant-time compare, growing waits after 5 wrong PINs; the app isn't rendered at all while locked (a cookie makes the server render the lock screen from the first byte); Face ID / fingerprint via WebAuthn platform authenticators with user verification | unit: `app-lock.test.ts`; e2e (incl. a virtual authenticator) |

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

- **Security depends on each member's Google account or password.** Anyone who controls an approved Google account, or knows a member's password, can sign in as that member. Members should turn on 2-Step Verification in their Google account and use a password they don't use anywhere else. There is no two-factor authentication for password sign-in.
- **Administrator-set passwords** are known to the administrator until the member replaces them (forced at first sign-in). A **reset** therefore gives the administrator a way to sign in as a member — it is audited and signs the member out, but it is not prevented. Infrastructure owners can do more than that anyway (below).
- **App lock is a privacy screen, not encryption.** It stops someone who picks up an unlocked phone; it doesn't protect against someone who can sign in to the account, or who has the device and developer tools. Notifications still appear on the lock screen (turn off *Show message text* to hide previews). The Face ID / fingerprint check happens on the device; the app trusts the browser's answer (no server verification).
- **View-once photos can still be photographed or screenshotted** — browsers can't block that. The sender can't see the photo again either.
- **Timed notifications** depend on pg_cron and pg_net in Supabase and on the app's address being reachable (Vercel Deployment Protection off for production). Without them, love notes and reminders are delivered when either person opens the app.
- **No self-service "forgot password" email** (it would need an email-sending service); the administrator resets passwords instead.
- **Changing a password in Settings** asks for the current password in the app; Supabase Auth itself only requires a signed-in session (Supabase's default), so someone holding an unlocked, signed-in device could change it with developer tools.
- **Existing access tokens stay cryptographically valid until expiry** (default 1 hour) after revocation. They are useless — RLS denies every read/write and Realtime stops delivering — but tune *Auth → JWT expiry* lower if you want them to expire sooner.
- **Member directory and presence:** active members can see each other's names and email addresses (needed to start conversations), whether they are online, and when they were last seen. There is no option yet to hide "last seen".
- **Group history:** someone re-added to a group sees its earlier history again.
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
