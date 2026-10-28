# Ghostline — private, invitation-only messaging

A minimal, dark-mode messaging app for a closed group of people. Only phone numbers that the administrator has approved can sign in (SMS one-time code), and the database itself enforces who can read and send what.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 + shadcn/ui-style components · Supabase (Postgres, Phone Auth, Realtime, Storage) · Vercel

## Features

- **Invitation-only phone login** — SMS OTP; unapproved numbers can't create an account, get a code, or obtain a token.
- **Instant revocation** — disabling a number cuts off existing sessions immediately (checked on every query), ends refresh tokens, and blocks new tokens.
- **1:1 conversations** with realtime delivery, sent/delivered/read indicators, unread counts, last-message previews, infinite history (paginated), search, multiline messages, edit (time-limited) and delete-for-everyone.
- **Attachments** (images, PDFs, office docs; 10 MB) in a private bucket served by short-lived signed URLs.
- **Duplicate-safe sending** — every message carries a client-generated id; retries can't create duplicates. Failed sends can be retried or discarded.
- **Reconnect handling** — automatic catch-up after network loss or tab sleep.
- **Admin dashboard** — allowlist management, account deletion, conversation metadata, storage usage, retention settings, and an append-only audit log.
- **Explicit privacy policy for admins** — administrators *cannot* read messages unless an audited, member-visible policy is switched on.

## Documentation

| Document | What's inside |
| --- | --- |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | **Start here.** Beginner-friendly, step-by-step setup: local dev → Supabase → SMS → Vercel → backups. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture overview, file tree, database schema, authorization design. |
| [docs/SECURITY.md](docs/SECURITY.md) | Every security control explained, encryption model, limitations, how each policy is tested. |
| [docs/SECURITY_TESTING_CHECKLIST.md](docs/SECURITY_TESTING_CHECKLIST.md) | Manual checklist to run after every deployment. |
| [docs/PRIVACY_AND_DATA.md](docs/PRIVACY_AND_DATA.md) | What data is stored, admin access policy, retention, data-deletion procedure. |

## Quick start (local, no SMS provider needed)

Requires Node.js 20.9+ and Docker Desktop.

```bash
npm install
```

```bash
npx supabase start
```

```bash
npx supabase status -o env
```

Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` (`API_URL`), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`ANON_KEY`), `SUPABASE_SERVICE_ROLE_KEY` (`SERVICE_ROLE_KEY`) and an `APP_SECRET` (`openssl rand -hex 32`). Then:

```bash
npm run dev
```

Open http://localhost:3000 and sign in with **+15550000001** (admin), **+15550000002** or **+15550000003**, code **123456** (local test numbers from `supabase/seed.sql`; no SMS is sent).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, build, run |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript strict check |
| `npm test` | Unit tests (validation, CSRF checks, error mapping, rate-limit keys) |
| `npm run test:db` | Database security suite (39 tests) — RLS, RPCs, allowlist, revocation, storage policies |
| `npm run test:integration` | End-to-end against a running local Supabase (+ app, for API tests) |

## Honest status

- Verified locally on Supabase's own stack (Postgres 17, Auth, Realtime, Storage): all unit, database and integration tests pass, plus a two-browser test of login → messaging → read receipts → search → admin revocation. Production deployment, real SMS delivery and Vercel hosting **must be done by you** (see DEPLOYMENT.md) and re-tested with the checklist.
- **Not end-to-end encrypted.** Messages are encrypted in transit (TLS) and at rest (Supabase infrastructure), and protected by strict access control — but the server can read them. See SECURITY.md for the E2EE upgrade path.
