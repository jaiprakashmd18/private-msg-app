# Deployment guide (beginner-friendly)

Follow the steps in order. Everything is done in websites; the only terminal steps are optional (local development).

> **What you must do yourself:** create the accounts (Supabase, Google Cloud, GitHub, Vercel), paste secrets into dashboards, and click through settings. Claude cannot log into those services for you.

## Costs at a glance

| Service | Free? | Notes |
| --- | --- | --- |
| Supabase | ✅ Free plan | Free projects pause after ~1 week of inactivity (resume from the dashboard). No downloadable automatic backups on Free. |
| Google sign-in (Google Cloud OAuth) | ✅ Free | No billing account needed for "Sign in with Google". |
| Vercel | ✅ Hobby plan | For personal, non-commercial use; the daily cleanup job is included. |
| GitHub | ✅ | Keep the repository **private**. |

There are **no SMS costs**: people sign in with their Google (Gmail) account.

---

## 1. Create the Supabase project

1. Go to https://supabase.com/dashboard → **New project**. Pick a region near you, set a strong database password and save it in a password manager.
2. When it's ready, open **Project Settings → API Keys** (older projects: **Project Settings → API**) and copy into a private note:
   - **Project URL** (`https://<ref>.supabase.co`). The `<ref>` part is your *project ref*.
   - **Publishable key** (`sb_publishable_…`) or legacy **anon** key.
   - **Secret key** (`sb_secret_…`) or legacy **service_role** key. **Never share it.**

## 2. Create the database tables and security rules

1. In GitHub, open the file `supabase/setup_all.sql`, click the **Copy raw file** button (two overlapping squares, top right of the file).
2. In Supabase open **SQL Editor → New query**, paste, and click **Run**. It should say *Success* (this file is all six files from `supabase/migrations` combined).
3. (Alternative: run the six files in `supabase/migrations` one by one in filename order, or use the CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.)
4. Check **Database → Tables** shows `authorized_emails`, `profiles`, `conversations`, `conversation_members`, `messages`, `attachments`, `app_settings`, `audit_logs`, and **Storage** shows a private `attachments` bucket.

> **Already ran the older phone-number version of these files?** Create a new, empty Supabase project and run the six current files there. They are not designed to be applied on top of the old ones.

## 3. Make yourself the administrator

1. In GitHub open `supabase/snippets/create_first_admin.sql`.
2. Paste it into the SQL Editor and replace **both** `you@gmail.com` with **your own Gmail address**.
3. Click **Run**. There is deliberately no "make me admin" button in the app; only the database owner can do this.

## 4. Set up "Sign in with Google"

### 4a. Google Cloud (creates the login keys; free)
1. Go to https://console.cloud.google.com and sign in. At the top, click the project picker → **New project** → name it (e.g. "Ghostline") → **Create**, then select it.
2. Open **APIs & Services → OAuth consent screen** (newer UI: **Google Auth Platform → Branding**). Click **Get started**:
   - App name: your app's name. User support email: your Gmail.
   - Audience: **External**.
   - Contact email: your Gmail. Agree and **Create**.
3. **Audience** page: under *Publishing status* click **Publish app**. (While it stays in "Testing", only accounts you add as *test users* can sign in, which is fine too if you prefer.) The app only asks for name and email, so Google doesn't require a review.
4. **Clients** (or **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**. Name: anything.
   - **Authorized redirect URIs → Add URI:** `https://<ref>.supabase.co/auth/v1/callback`. Copy the exact value from Supabase (step 4b shows it as *Callback URL*).
   - **Create**. Copy the **Client ID** and **Client secret**.

### 4b. Supabase
1. **Authentication → Sign In / Providers** (older UI: *Providers*):
   - **Google**: enable it, paste the **Client ID** and **Client secret**, and save. (Here you can also copy the *Callback URL* for step 4a.)
   - **Email**: turn **off**. **Phone**: leave **off**. **Anonymous sign-ins**: **off**.
   - Keep **Allow new users to sign up** **ON**. New approved people need it the first time; everyone else is still refused by the database rules.
2. **Authentication → Hooks** → add two hooks, both type **Postgres**, schema `public`:
   - **Before User Created** → function `before_user_created_hook`
   - **Customize Access Token (JWT) Claims** → function `custom_access_token_hook`

   (If your plan doesn't offer one of these, the database trigger and security rules still enforce the allowlist; see SECURITY.md.)

## 5. Put the app online with Vercel

1. https://vercel.com → sign up **with GitHub** → **Add New… → Project** → import your repository. Framework is detected as **Next.js**; leave the build settings alone.
2. Before clicking **Deploy**, open **Environment Variables** and add:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from step 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret / service_role key (mark as *Sensitive*) |
| `CRON_SECRET` | Any long random string (e.g. 64 random letters and digits) |
| `NEXT_PUBLIC_APP_NAME` | Optional: the name shown in the app |

3. Click **Deploy**. When it's done you get an address like `https://your-app.vercel.app`.
4. Changed a `NEXT_PUBLIC_…` value later? Redeploy (Deployments → ⋯ → **Redeploy**); those values are built into the app.

## 6. Tell Supabase where the app lives

Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://your-app.vercel.app` (or your own domain)
- **Redirect URLs → Add URL:** `https://your-app.vercel.app/auth/callback`

Without this, Google sign-in returns to the wrong place.

**Own domain (optional):** Vercel → Settings → **Domains** → add it and create the DNS records shown. HTTPS is automatic. Then use the domain in both Supabase fields above (and add its `/auth/callback`).

## 7. Sign in and invite people

1. Open your app → **Continue with Google** → choose the Gmail account from step 3.
2. Click the **shield icon** → **Members & access** → enter each person's Gmail address → **Approve**.
3. They open the same link and click **Continue with Google**. Anyone not on your list sees *"This Google account isn't approved"*, and no account is created for them.

Any Google account works, including Google Workspace (company) addresses; it doesn't have to end in `@gmail.com`.

## 7b. Install on phones and turn on notifications

The app is an installable web app (PWA): no app store, nothing extra to host or configure.

- **Android (Chrome):** open the app → **Settings → App & notifications → Install app** (or Chrome menu ⋮ → *Install app*). Then tap **Turn on notifications** and allow.
- **iPhone / iPad (iOS 16.4+):** open the app in **Safari** → Share button → **Add to Home Screen**. Open the app **from the new icon**, then **Settings → Turn on notifications** and allow. (Apple only allows notifications for apps added to the Home Screen.)
- **Computer (Chrome/Edge):** the install icon in the address bar, or Settings → Install app.

Notifications are per device: turn them on on each phone/computer you use. *Show message text in notifications* can be switched off if others can see your lock screen. Signing out turns notifications off for that device.

**Already set up the database before this feature existed?** Run `supabase/update_push_notifications.sql` once in the SQL Editor (copy it from GitHub like `setup_all.sql`). New projects don't need it.

## 8. Test that access control works

Run the checklist in [SECURITY_TESTING_CHECKLIST.md](SECURITY_TESTING_CHECKLIST.md). At minimum:
- a Google account you did **not** approve is refused;
- disabling someone kicks them out on their next action, and they can't sign back in;
- a normal member can't open `/admin`;
- two approved accounts can chat, and messages appear instantly and are still there after signing out and in.

## 9. Backups and retention

**Retention** (Admin → Privacy & retention): default is *keep forever*. If you set N days, a daily job permanently deletes older messages and files. Audit logs are kept 365 days by default.

**Backups:**
- **Free plan:** no downloadable automatic backups. Occasionally run (from the project folder on your computer):
  ```bash
  npx supabase db dump --linked -f backup-schema.sql
  ```
  ```bash
  npx supabase db dump --linked --data-only -f backup-data.sql
  ```
  Keep the files somewhere encrypted; they contain all messages. Attachments are **not** included in these dumps.
- **Pro plan:** daily backups (7 days) are automatic.

---

## Optional: run it on your own computer

Requires Node.js 20.9+ (https://nodejs.org) and Docker Desktop.

1. Create a **second** OAuth client in Google Cloud (step 4a) with the redirect URI `http://127.0.0.1:54321/auth/v1/callback`.
2. In the project folder:
   ```bash
   npm install
   ```
   ```bash
   export SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<client id> SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<client secret>
   ```
   ```bash
   npx supabase start
   ```
3. Edit `supabase/seed.sql`: replace the example addresses with your test Gmail accounts (first one is admin), then:
   ```bash
   npx supabase db reset
   ```
4. Copy `.env.example` to `.env.local` and fill it from `npx supabase status -o env` (`API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`).
5. Start the app with `npm run dev` and open http://localhost:3000.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "This Google account isn't approved" | Add that exact email under Admin → Members & access (the first admin: step 3). |
| "Access … is currently disabled" | Re-enable the account under Members & access. |
| Google shows `redirect_uri_mismatch` | The redirect URI in Google Cloud must be exactly `https://<ref>.supabase.co/auth/v1/callback`. |
| After Google you land on the Vercel home page or localhost | Fix Site URL / Redirect URLs (step 6). |
| Google says the app is in testing / access blocked | Publish the app (step 4a.3) or add the person as a test user. |
| "Invalid public environment configuration" | A `NEXT_PUBLIC_*` variable is missing in Vercel; add it and redeploy. |
| "Turn on notifications" fails with an error | Run `supabase/update_push_notifications.sql` (step 7b) if your database predates notifications. |
| No notifications on iPhone | The app must be opened from the Home Screen icon (iOS 16.4+), and notifications allowed in iPhone Settings → Notifications → (app name). |
| Notifications stopped | Phone settings may have blocked them, or the subscription expired: Settings → Turn off notifications → Turn on again. |
| Messages only appear after refresh | Make sure migration `…0500` ran (it enables Realtime for messages). |
