# Ghostline — private, invitation-only messaging

A minimal, dark-mode messaging app for a closed group of people. People sign in with their Google (Gmail) account, or with an email and password, but only emails the administrator has approved get in, and the database itself enforces who can read and send what.

**Stack:** Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 + shadcn/ui-style components · Supabase (Postgres, Auth with Google + password, Realtime, Storage) · Vercel

## Features

- **Invitation-only sign-in** — *Continue with Google*, or **email + password** for people without a Google account (or who prefer it). Nobody can sign themselves up: password accounts are created only by the administrator, with a temporary password the member must replace on first sign-in. Members can add or change a password in Settings. Unapproved accounts can't create an account or obtain a token.
- **Instant revocation** — disabling an account cuts off existing sessions immediately (checked on every query), ends refresh tokens, and blocks new tokens.
- **1:1 and group chats** (up to 50 people, group admins, add/remove/rename, leave) with realtime delivery, sent/delivered/read indicators, unread counts, previews, paginated history, search, multiline messages, edit (time-limited) and delete-for-everyone.
- **Replies, reactions, typing, online** — swipe or tap to reply with a quote, one emoji reaction per person, "typing…" and "online / last seen" over private realtime channels.
- **Photos & voice notes** — big photos are shrunk to 2048 px with chat thumbnails, up to 10 per message, full-screen viewer (swipe, zoom, download), phone camera button; hold-free voice recording (up to 5 min) with a player. Files (PDF, office docs) too; everything in a private bucket via short-lived signed URLs.
- **Duplicate-safe sending** — every message carries a client-generated id; retries can't create duplicates. Failed sends can be retried or discarded.
- **Reconnect handling** — automatic catch-up after network loss or tab sleep.
- **Installable phone app (PWA)** — "Add to Home Screen" on iPhone/Android/desktop with its own icon, full-screen mode, unread badge and an offline page. No app store needed.
- **Fits every screen** — phones (also sideways), tablets, laptops and big monitors; respects the notch and home indicator, keeps the message box above the on-screen keyboard (iPhone and Android), no zoom-on-tap on iPhone, readable line lengths on wide screens. Checked automatically at 9 screen sizes from 320 px phones to 1920 px desktops.
- **Push notifications** — per device, with an option to hide message text on the lock screen; sent only to active members, once per message.
- **Profile and group photos** — members pick their own photo (cropped to a square in the browser); group admins set the group photo. Stored in a private bucket, visible only to active members.
- **Access requests** — when someone not on the list tries to sign in with Google, a request appears in *Admin → Access requests* (with a badge on the shield icon). Accept lets them in on their next sign-in; Decline keeps them out. No account is created until you accept.
- **Made for two** — features for a couple's chat:
  - **App lock** — PIN, plus Face ID / fingerprint where the device supports it; locks on start and after a chosen time away; slows down guessing.
  - **View-once photos** — opened one time by the other person, then deleted; no thumbnail is ever stored.
  - **Chat look** — your own wallpaper photo and bubble colour per chat.
  - **"Thinking of you"** — one tap sends a heart: floating hearts on their screen and a buzzing notification.
  - **Memories** — every photo you've shared, in one gallery by month.
  - **Special dates** — "Day 412 together", birthday/anniversary countdowns, and a celebration in the chat on the day.
  - **Love notes for later** — write now, delivered at the time you pick (e.g. "Good morning" at 7 am), with a notification.
  - **Our list** — a shared to-do / shopping list that updates live for both.
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
| `npm run test:db` | Database security suite (59 tests) — RLS, RPCs, allowlist, revocation, storage policies |
| `npm run test:integration` | End-to-end against a running local Supabase (+ app, for API tests) |

## Honest status

- Verified locally on Supabase's own stack (Postgres 17, Auth, Realtime, Storage): all unit, database and integration tests pass, plus a two-browser test of messaging → read receipts → admin allowlist → revocation. The Google redirect itself can't be automated in tests (it needs real Google credentials), so the first sign-in on your deployment is the final check. Deployment **must be done by you** (see DEPLOYMENT.md), then re-tested with the checklist.
- **Not end-to-end encrypted.** Messages are encrypted in transit (TLS) and at rest (Supabase infrastructure), and protected by strict access control — but the server can read them. See SECURITY.md for the E2EE upgrade path.
