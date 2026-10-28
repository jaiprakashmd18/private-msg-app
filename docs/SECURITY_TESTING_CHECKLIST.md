# Manual security-testing checklist

Run after every production deployment and after changing auth settings. You need: the admin number, two approved member numbers (A, B), one **unapproved** number (U), two browsers (or one normal + one private window), and the browser developer tools.

Mark each item ✅/❌. Any ❌ is a release blocker.

## Sign-in and allowlist
- [ ] U enters their number → sees the generic "If this number is approved…" message and **receives no SMS**.
- [ ] Supabase → Authentication → Users shows **no** user for U.
- [ ] Admin → Audit log shows `auth.otp_denied` with a **masked** number.
- [ ] A signs in with the correct code → lands on `/chat`.
- [ ] A wrong code shows "invalid or has expired"; ~8 wrong codes in 15 minutes → "Too many attempts".
- [ ] Requesting codes repeatedly for one number → "Too many attempts" (1/minute, 5/hour).
- [ ] Direct API bypass: in the browser console on the login page run
      `await fetch("https://<ref>.supabase.co/auth/v1/otp",{method:"POST",headers:{apikey:"<publishable key>","content-type":"application/json"},body:JSON.stringify({phone:"<U>"})}).then(r=>r.status)` → **403**, and no user is created.

## Isolation between members
- [ ] A and B chat; the admin (or a third member C) opens the conversation URL `/chat/<id>` → "Conversation unavailable", no messages.
- [ ] Signed in as C, open DevTools → Network, copy C's `Authorization: Bearer …` value from any `rest/v1` request, then in the console run
      `fetch("https://<ref>.supabase.co/rest/v1/messages?select=*",{headers:{apikey:"<publishable>",Authorization:"Bearer <C token>"}}).then(r=>r.json())` → returns only C's own conversations' messages.
- [ ] Same token: `POST /rest/v1/rpc/send_message` with A–B's conversation id → error "not a member".
- [ ] Same token: `PATCH /rest/v1/authorized_phone_numbers?phone_e164=eq.<C>` body `{"role":"admin"}` → permission denied.
- [ ] Same token: `POST /rest/v1/rpc/admin_stats` → "Administrator privileges required".

## Revocation
- [ ] B is signed in with a conversation open. Admin disables B. B sends a message → redirected to "Access not available".
- [ ] B reloads / signs in again → code accepted by SMS but sign-in refused ("does not currently have access").
- [ ] Admin re-enables B → B can sign in and sees the full history.
- [ ] Admin removes B from the allowlist → same as disable; re-adding B restores the account.

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
