# Privacy, data handling and deletion

The in-app privacy notice lives at `/privacy` (`src/app/privacy/page.tsx`). This document is the operator's reference.

## Data stored

| Data | Where | Who can read it in the app |
| --- | --- | --- |
| Account email, display name (initially the admin's label or the Google name), bio, last seen | `profiles`, `authorized_emails`, `auth.users` | Active members (directory); admin |
| Messages (text, timestamps, edit/delete markers) | `messages` | Members of that conversation only; admin **only if** the audited policy is on |
| Files | Storage bucket `attachments` + `attachments` table | Members of that conversation only |
| Push notification subscriptions (an opaque address + keys per device, "show preview" choice, browser name) | `push_subscriptions` | Only the owner; used by the server to send notifications |
| Reactions, replies, group names and membership changes | `message_reactions`, `messages`, `conversations`, `conversation_members` | Members of that conversation |
| Voice notes and photos (photos are resized to max 2048 px with a small thumbnail) | Storage bucket `attachments` | Members of that conversation |
| Online status and "last seen" | Realtime presence (not stored); `profiles.last_seen_at` | Active members |
| Profile photos and group photos (cropped to 320 px squares) | Storage bucket `avatars`; `profiles.avatar_path`, `conversations.avatar_path` | Active members |
| Access requests from people not on the list: Google email, Google name, Google profile-picture link, number of attempts, dates, decision | `access_requests` | Admin only |
| Passwords (only for people who use email + password) — stored by Supabase Auth as a bcrypt hash, never in plain text; the app also remembers the hash of an administrator-set temporary password, only to know whether it has been replaced | `auth.users`, `private.admin_set_passwords` | Nobody can read a password; the administrator sees only whether one is set |
| Delivery/read watermarks | `conversation_members` | Members of that conversation |
| Security events (masked email addresses, actor ids, admin actions) | `audit_logs` | Admin |

Not stored by the app: Google passwords (sign-in happens on Google's own page), plain-text passwords (temporary passwords are shown to the administrator once and never saved), message content in logs, IP addresses. Supabase and Vercel keep their own operational logs (including IPs) per their policies.

## Administrator access policy

- **Default: administrators cannot read message content** through the app. They see counts, members and timestamps.
- An administrator can enable *Admin → Privacy & retention → Allow administrators to read messages*. When on:
  - every member sees a banner in each conversation and in Settings;
  - content is only available through an RPC that writes an `admin.messages_viewed` audit entry per view;
  - the change itself is audited (`admin.settings_updated` with before/after values).
- Anyone with owner access to the Supabase project (dashboard/SQL) can technically read all data. Limit who has that access and enable 2FA on the Supabase and Vercel accounts.

### Passwords set by the administrator

A temporary password lets the administrator, technically, sign in as that member until the member replaces it. The app therefore: forces the member to choose their own password at first sign-in; records every set/reset in the audit log (`admin.password_account_created`, `admin.password_reset`); signs the member out everywhere on a reset; and never lets an administrator set a password for another administrator. A member who notices they were signed out unexpectedly should ask the administrator why.

## Retention

- Messages: kept until deleted, unless *Delete messages older than N days* is set; then a daily job (and *Run retention now*) hard-deletes older messages and their files.
- Access requests: pending requests stay until accepted or declined; decided requests are deleted 90 days after the decision by the daily job. At most 500 pending requests are kept, so the list can't be flooded.
- Audit log: 365 days by default (30–3650 configurable).
- Orphaned uploads (files never attached, or whose message was deleted): removed after 24 hours by the same job.

## Data-deletion procedure

**A member deleting a message:** message menu → *Delete for everyone*. The text is erased immediately and its files are removed; a "This message was deleted" placeholder remains.

**Deleting a member's account and data (right to erasure)** — performed by the administrator:
1. Verify the request comes from the account's owner (e.g. ask them to message you from the app).
2. *Admin → Members & access* → find the email → **Delete account** → confirm. This, atomically and audited:
   - signs them out everywhere;
   - permanently deletes every message they sent and every file they uploaded;
   - deletes their profile, memberships and their Supabase Auth user (sign-in record).
3. If they should never sign in again, also click **Remove** (allowlist entry).
4. Conversations they took part in remain for the other member, showing the deleted user's messages as gone and their name as "Deleted user".
5. Note in your records: data persists in **backups** until those expire (Pro: 7 days; your own dumps: until you delete them). Delete or rotate manual dumps accordingly.

**Deleting a whole conversation:** *Admin → Conversations → Delete* removes all its messages and files for both members.

**Deleting everything (shutting the service down):** delete the Supabase project (Project Settings → General → Delete project) and the Vercel project, and destroy any dumps.
