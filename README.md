# Ghostline — private, invitation-only messaging

A minimal, dark-mode messaging app for a closed group of people. People sign in with their Google (Gmail) account, but only accounts whose email the administrator has approved get in, and the database itself enforces who can read and send what.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 + shadcn/ui-style components · Supabase (Postgres, Google Auth, Realtime, Storage) · Vercel

## Features

- **Invitation-only Google sign-in** — no passwords, no SMS costs; unapproved Google accounts can't create an account or obtain a token, and other sign-in methods are refused.
- **Instant revocation** — disabling an account cuts off existing sessions immediately (checked on every query), ends refresh tokens, and blocks new tokens.
- **1:1 conversations** with realtime delivery, sent/delivered/read indicators, unread counts, last-message previews, infinite history (paginated), search, multiline messages, edit (time-limited) and delete-for-everyone.
- **Attachments** (images, PDFs, office docs; 10 MB) in a private bucket served by short-lived signed URLs.
- **Duplicate-safe sending** — every message carries a client-generated id; retries can't create duplicates. Failed sends can be retried or discarded.
- **Reconnect handling** — automatic catch-up after network loss or tab sleep.
- **Installable phone app (PWA)** — "Add to Home Screen" on iPhone/Android/desktop with its own icon, full-screen mode, unread badge and an offline page. No app store needed.
- **Push notifications** — per device, with an option to hide message text on the lock screen; sent only to active members, once per message.
- **Admin dashboard** — allowlist management, account deletion, conversation metadata, storage usage, retention settings, and an append-only audit log.
- **Explicit privacy policy for admins** — administrators *cannot* read messages unless an audited, member-visible policy is switched on.

## Documentation

| Document | What's inside |
| --- | --- |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | **Start here.** Beginner-friendly, step-by-step setup: Supabase → Google sign-in → Vercel → inviting people → backups. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture overview, file tree, database schema, authorization design. |
| [docs/SECURITY.md](docs/SECURITY.md) | Every security control explained, encryption model, limitations, how each policy is tested. |
| [docs/SECURITY_TESTING_CHECKLIST.md](docs/SECURITY_TESTING_CHECKLIST.md) | Manual checklist to run after every deployment. |
| [docs/PRIVACY_AND_DATA.md](docs/PRIVACY_AND_DATA.md) | What data is stored, admin access policy, retention, data-deletion procedure. |

## Getting started

Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). It takes about 30–45 minutes, everything is done in websites, and it ends with the app online and you signed in as administrator. Running locally is optional (see the end of that guide).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, build, run |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript strict check |
| `npm test` | Unit tests (validation, CSRF checks, error mapping, notifications, service worker) |
| `npm run test:db` | Database security suite (46 tests) — RLS, RPCs, allowlist, revocation, storage policies |
| `npm run test:integration` | End-to-end against a running local Supabase (+ app, for API tests) |

## Honest status

- Verified locally on Supabase's own stack (Postgres 17, Auth, Realtime, Storage): all unit, database and integration tests pass, plus a two-browser test of messaging → read receipts → admin allowlist → revocation. The Google redirect itself can't be automated in tests (it needs real Google credentials), so the first sign-in on your deployment is the final check. Deployment **must be done by you** (see DEPLOYMENT.md), then re-tested with the checklist.
- **Not end-to-end encrypted.** Messages are encrypted in transit (TLS) and at rest (Supabase infrastructure), and protected by strict access control — but the server can read them. See SECURITY.md for the E2EE upgrade path.
