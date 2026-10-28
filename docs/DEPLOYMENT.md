# Deployment guide (beginner-friendly)

Follow the steps in order. Each command goes in a terminal (macOS: Terminal; Windows: PowerShell or the VS Code terminal) opened **in the project folder** unless stated otherwise.

> **What you must do yourself:** creating accounts (Supabase, Twilio or another SMS provider, GitHub, Vercel), entering payment details where required, pasting secrets into dashboards, and clicking through dashboard settings. Claude cannot log into those services for you.

## Costs at a glance

| Service | Free tier? | Notes |
| --- | --- | --- |
| Supabase | ✅ Free plan works | Free projects pause after ~1 week of inactivity (resume from the dashboard). No automatic downloadable backups on Free. |
| Vercel | ✅ Hobby plan works | Hobby is for personal, non-commercial use; daily cron jobs are included. |
| GitHub | ✅ | Use a **private** repository. |
| **SMS (Twilio, MessageBird, Vonage, Textlocal…)** | ❌ **Paid** | Every OTP text costs money (typically a few cents, varies by country). Twilio trial accounts can only text numbers you have verified in Twilio. |

---

## 1. Install Node.js and get the project

1. Install **Node.js 22 LTS** from https://nodejs.org (any version ≥ 20.9 works). Check:
   ```bash
   node -v
   ```
2. Install **Git** (https://git-scm.com) and **Docker Desktop** (https://www.docker.com/products/docker-desktop/ — only needed to run Supabase locally).
3. Get the code (if you are not already in the project folder):
   ```bash
   git clone https://github.com/<you>/private-msg-app.git
   ```
   ```bash
   cd private-msg-app
   ```
4. Install dependencies (exact versions are pinned in `package.json` / `package-lock.json`):
   ```bash
   npm install
   ```

> This project was created by hand rather than with `create-next-app`, so there is nothing else to scaffold. Main packages: `next@16.4.3`, `react@19.3.1`, `@supabase/supabase-js@2.118.0`, `@supabase/ssr@0.12.7`, `tailwindcss@4.3.3`, `zod@4.6.7`, Radix UI primitives; dev: `supabase@2.122.0` CLI, `vitest@5.0.5`, `typescript@5.9.3`.

## 2. Run everything locally first (optional but recommended)

1. Start Docker Desktop, then start a local Supabase (first run downloads several GB):
   ```bash
   npx supabase start
   ```
   This applies all migrations in `supabase/migrations` and the local-only test numbers in `supabase/seed.sql`.
2. Show the local keys:
   ```bash
   npx supabase status -o env
   ```
3. Copy the env template:
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local`: `NEXT_PUBLIC_SUPABASE_URL` = `API_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` = `SERVICE_ROLE_KEY`, and set `APP_SECRET` / `CRON_SECRET` to the output of:
   ```bash
   openssl rand -hex 32
   ```
   (No `openssl`? Use `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.)
4. Run the app:
   ```bash
   npm run dev
   ```
5. Open http://localhost:3000 and sign in with `+15550000001` (admin), `+15550000002` or `+15550000003`; the code is always `123456`. These test numbers only exist locally (see `[auth.sms.test_otp]` in `supabase/config.toml`).
6. Test with two accounts: open a second browser (or a private window), sign in as another number, start a conversation and send messages both ways.

## 3. Create the Supabase project

1. Go to https://supabase.com/dashboard → **New project**. Pick a region close to your users, set a strong database password and save it in a password manager.
2. When it's ready, open **Project Settings → API Keys** (older projects: **Project Settings → API**). Note:
   - the **Project URL** (`https://<ref>.supabase.co`),
   - the **publishable key** (`sb_publishable_…`) or legacy **anon** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   - the **secret key** (`sb_secret_…`) or legacy **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`. **Never share it or put it in client code.**

## 4. Run the database migrations (tables + RLS policies)

**Option A – Supabase CLI (recommended):**
```bash
npx supabase login
```
```bash
npx supabase link --project-ref <your-project-ref>
```
```bash
npx supabase db push
```
`db push` applies the six files in `supabase/migrations/` in order. It does **not** run `seed.sql` (good — the test numbers must never exist in production).

**Option B – SQL Editor:** in the dashboard open **SQL Editor**, paste the contents of each file in `supabase/migrations/` **in filename order**, and run them one at a time.

Check: **Database → Tables** shows `authorized_phone_numbers`, `profiles`, `conversations`, `conversation_members`, `messages`, `attachments`, `app_settings`, `audit_logs`, all with RLS enabled. **Storage** shows a private `attachments` bucket.

## 5. Configure phone authentication and the auth hooks

1. **SMS provider.** Create an account with Twilio (https://www.twilio.com) — or MessageBird / Vonage / Textlocal. For Twilio you need: *Account SID*, *Auth Token*, and a *Messaging Service SID* (create a Messaging Service with a sender number). Trial accounts can only text verified numbers.
2. Supabase dashboard → **Authentication → Sign In / Providers** (older UI: *Providers*):
   - **Phone**: enable, choose your SMS provider, paste the credentials, save. Keep *SMS OTP Expiry* short (e.g. 300 seconds) and OTP length 6.
   - **Email**: disable (this app does not use email).
   - Keep **Allow new users to sign up** ON — newly approved numbers need it. Unapproved numbers are still blocked by the hook and the database trigger.
   - Keep **anonymous sign-ins** OFF.
3. **Authentication → Hooks** → add:
   - **Before User Created** → type *Postgres* → schema `public` → function `before_user_created_hook`.
   - **Customize Access Token (JWT) Claims** → type *Postgres* → schema `public` → function `custom_access_token_hook`.
   (If your plan doesn't offer one of these hooks, the database trigger and RLS still enforce the allowlist; you lose the "no token for disabled users" layer described in SECURITY.md.)
4. **Authentication → Rate Limits**: keep SMS limits low (e.g. 30/hour for the project). **Authentication → Attack Protection**: optionally enable CAPTCHA (requires adding the widget to the login form).
5. **Authentication → URL Configuration**: set **Site URL** to your production URL (after step 11) — e.g. `https://chat.example.com`.

## 6. Create the first administrator (securely)

There is deliberately no "make me admin" button. In **SQL Editor**, open `supabase/snippets/create_first_admin.sql`, replace `+10000000000` with **your** number in international format (e.g. `+447700900123`), and run it. This adds your number to the allowlist with `role = 'admin'`. Only the database owner can do this.

## 7. Add the first approved phone numbers

Sign in to the deployed app (or local app pointed at production) as the admin → **Admin → Members & access → Approve a phone number**. Each number can sign in immediately. (You can also insert rows with SQL, but the dashboard logs the action in the audit log.)

## 8. Configure environment variables locally

For local development against **production** Supabase (not recommended for day-to-day work), put the production URL/keys in `.env.local`. Otherwise keep `.env.local` pointed at the local stack from step 2.

## 9. Test messaging with two authorized accounts

With two approved numbers (two phones, or one phone plus a second approved number): sign in on two devices, start a conversation, verify messages appear instantly, the ✓ → ✓✓ → blue ✓✓ indicators update, unread counts clear when opening the chat, and history remains after signing out and back in.

## 10. Push the code to GitHub

1. Create a **private** repository on https://github.com/new (no README/license — the project has its own).
2. In the project folder:
   ```bash
   git add -A
   ```
   ```bash
   git commit -m "Initial commit"
   ```
   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   ```
   ```bash
   git push -u origin main
   ```
3. Confirm `.env.local` is **not** on GitHub (it is in `.gitignore`).

## 11. Deploy on Vercel

1. https://vercel.com → **Add New… → Project** → import your GitHub repository. Framework preset: **Next.js** (auto-detected). Leave build settings at defaults.
2. Before clicking **Deploy**, add environment variables (step 12).
3. Deploy. Vercel builds on every push to `main`.

## 12. Production environment variables and domain

In Vercel → Project → **Settings → Environment Variables** (Environment: *Production*, and *Preview* if you use previews):

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | secret/service_role key (**mark as Sensitive**) |
| `APP_SECRET` | new random 64-hex string (don't reuse local) |
| `CRON_SECRET` | another random string — Vercel sends it to `/api/cron/retention` automatically |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain` |
| `NEXT_PUBLIC_APP_NAME` | optional display name |

`NEXT_PUBLIC_*` values are baked in at build time: **redeploy after changing them** (Deployments → ⋯ → Redeploy).

**Domain:** Vercel → Settings → **Domains** → add your domain and create the DNS records it shows at your registrar. HTTPS certificates are automatic. Then set the same URL as **Site URL** in Supabase (step 5.5).

**Cron:** `vercel.json` schedules `/api/cron/retention` daily at 03:17 UTC. Check Vercel → Settings → **Cron Jobs**.

## 13. Test access control after deployment

Run the manual checklist in [SECURITY_TESTING_CHECKLIST.md](SECURITY_TESTING_CHECKLIST.md). At minimum:
- an unapproved number never receives a code;
- a disabled number is kicked out of an open session within one action and cannot sign in again;
- a member can't open `/admin`;
- the browser's network tab never shows the service key.

## 14. Backups and retention

**Retention** (Admin → Privacy & retention): default *keep forever*. Setting N days makes the daily job permanently delete older messages and their files. *Run retention now* applies it immediately. Audit logs are kept 365 days by default.

**Backups:**
- **Free plan:** no downloadable automatic backups. Take your own regularly:
  ```bash
  npx supabase db dump --linked -f backup-schema.sql
  ```
  ```bash
  npx supabase db dump --linked --data-only -f backup-data.sql
  ```
  Store dumps encrypted (they contain all messages). Attachments in Storage are **not** included in database dumps; download them separately if needed (e.g. with the Storage S3 protocol).
- **Pro plan:** daily backups (7 days) are automatic; Point-in-Time Recovery is an add-on.
- **Restore test:** periodically restore a dump into a new project with `psql` to make sure backups work.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Invalid public environment configuration" | A `NEXT_PUBLIC_*` variable is missing — set it and **rebuild/redeploy**. |
| Code never arrives | Is the number approved and active? SMS provider configured and funded? Twilio trial: number verified in Twilio? Check Supabase **Logs → Auth**. |
| "That code is invalid or has expired" | Request a new code; codes expire (see Phone provider settings). |
| Signed in but sent to "Access not available" | The number is disabled/removed, or the auth hooks are configured but migrations weren't applied. |
| Messages only appear after refresh | Check `alter publication supabase_realtime` ran (migration 0500) and Realtime is enabled for the project. |
| Local `supabase start` says phone login disabled | Keep `[auth.sms.twilio] enabled = true` in `config.toml` (placeholder values are fine locally). |
