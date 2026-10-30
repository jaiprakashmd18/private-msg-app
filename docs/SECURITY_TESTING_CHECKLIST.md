# Manual security-testing checklist

Run after every production deployment and after changing auth settings. You need: the admin Google account, two approved member Google accounts (A, B), one **unapproved** Google account (U), two browsers (or one normal + one private window), and the browser developer tools.

Mark each item ✅/❌. Any ❌ is a release blocker.

## Sign-in and allowlist
- [ ] U clicks **Continue with Google** → returns to the login page with "This Google account isn't approved…".
- [ ] Supabase → Authentication → Users shows **no** user for U.
- [ ] Admin → Audit log shows `auth.signup_rejected` with a **masked** email and provider `google`.
- [ ] A signs in with Google → lands on `/chat`.
- [ ] Nobody can sign themselves up with a password: in the browser console
      `await fetch("https://<ref>.supabase.co/auth/v1/signup",{method:"POST",headers:{apikey:"<publishable key>","content-type":"application/json"},body:JSON.stringify({email:"<an approved email that has no account yet>",password:"Long-password-123"})}).then(r=>r.status)`
      returns an error status (4xx/5xx), and no user appears in Authentication → Users.
- [ ] Admin → Members & access → **Set password** for a test email → sign in with it in a private window → you're sent to *Choose your password* and can't reach `/chat` until you do.
- [ ] A wrong password shows "That email and password don't match"; disabling the email makes the right password fail with "currently disabled".
- [ ] **Reset password** signs that person out on their other devices; the audit log shows `admin.password_reset`.
- [ ] Both auth hooks are listed under Authentication → Hooks.

## Isolation between members
- [ ] A and B chat; the admin (or a third member C) opens the conversation URL `/chat/<id>` → "Conversation unavailable", no messages.
- [ ] Signed in as C, open DevTools → Network, copy C's `Authorization: Bearer …` value from any `rest/v1` request, then in the console run
      `fetch("https://<ref>.supabase.co/rest/v1/messages?select=*",{headers:{apikey:"<publishable>",Authorization:"Bearer <C token>"}}).then(r=>r.json())` → returns only C's own conversations' messages.
- [ ] Same token: `POST /rest/v1/rpc/send_message` with A–B's conversation id → error "not a member".
- [ ] Same token: `PATCH /rest/v1/authorized_emails?email=eq.<C>` body `{"role":"admin"}` → permission denied.
- [ ] Same token: `POST /rest/v1/rpc/admin_stats` → "Administrator privileges required".

## Revocation
- [ ] B is signed in with a conversation open. Admin disables B. B sends a message → redirected to "Access not available".
- [ ] B signs out and tries **Continue with Google** again → refused with "Access … is currently disabled".
- [ ] Admin re-enables B → B can sign in and sees the full history.
- [ ] Admin removes B's email from the allowlist → same as disable; re-adding the email restores the account.

## Admin
- [ ] Member A visits `/admin` → redirected to `/chat`. `DELETE /api/admin/conversations/<id>` as A → 403.
- [ ] Admin's own row and other admin rows show "can only be changed by the database owner".
- [ ] Every destructive admin action asks for confirmation.
- [ ] Conversations page shows counts only; with the admin-read policy **off**, there is no "View" button.
- [ ] Turning the policy **on** shows a warning; members now see the amber "audited access" banner; each "View" creates an `admin.messages_viewed` audit entry.
- [ ] Turn the policy back **off** if you don't need it.

## Attachments
- [ ] A sends an image to B → B sees it; the image URL is a signed URL with `token=` and stops working after ~30 minutes.
- [ ] C requests a signed URL for that path via the Storage API → error.
- [ ] Uploading a 12 MB file or an `.html` file is rejected.
- [ ] Admin disables attachments → paperclip disappears; direct uploads are rejected.

## Transport, headers and secrets
- [ ] `http://` redirects to `https://`; certificate is valid.
- [ ] Response headers on `/login` include `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- [ ] Search the deployed JS bundles (DevTools → Sources → search) for the first 10 characters of your secret key → **not found**.
- [ ] `GET /api/cron/retention` without the cron secret → 401.

## Persistence and realtime
- [ ] Messages remain after sign-out/sign-in and on another device.
- [ ] Turn Wi-Fi off on B, send from A, turn Wi-Fi on → B catches up without a reload ("Reconnecting…" banner shows while offline).
- [ ] Retrying a failed send (airplane mode → send → reconnect → retry) produces exactly **one** message.
