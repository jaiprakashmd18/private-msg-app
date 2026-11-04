# Ghostline on Google Play and the App Store

This guide takes you from this repository to Ghostline in both stores. It is
written for someone who has never published an app. Do the parts in order.

**How the app works:** the Android and iPhone apps are a native "shell"
(Capacitor) that opens your live website,
`https://loveline.space`. Your website, Supabase,
accounts and messages stay exactly as they are; when you deploy the website,
the apps update too. Only native things (the app icon, notifications,
the Google sign-in window, Face ID, the back button) live in the app.

| What | Value |
| --- | --- |
| App name | Ghostline |
| App ID (Android package / iOS bundle ID) | `com.jaiprakash.ghostline` — can never change after publishing |
| App link scheme | `com.jaiprakash.ghostline://` |
| Website the app opens | set in `capacitor.config.ts` (`server.url`) |

---

## Part 1 — One-time website and Supabase setup (15 minutes)

These are needed for **both** stores. Merge the pull request first, so Vercel
deploys the in-app code.

### 1.1 Supabase: run the database update

Supabase → **SQL Editor** → **New query** → paste the whole file
`supabase/update_native_push.sql` → **Run**. (New projects that use
`setup_all.sql` already have it.)

### 1.2 Supabase: allow the app's sign-in return link

Supabase → **Authentication** → **URL Configuration** → **Redirect URLs** →
**Add URL** → `com.jaiprakash.ghostline://auth/callback` → **Save**.

Without this, "Continue with Google" in the app ends on the website instead of
returning to the app. Email + password sign-in needs nothing.

### 1.3 Vercel: settings the app uses

Vercel → your project → **Settings** → **Environment Variables**. Add these as
you get them in Parts 2 and 3 (each one is optional until you reach it), then
**Redeploy**.

| Name | What it is | From |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | Android notifications: the Firebase service account JSON (paste the whole file) | Part 2.3 |
| `APNS_KEY_ID` | iPhone notifications: the key's 10-character ID | Part 3.3 |
| `APNS_TEAM_ID` | Your Apple Team ID (10 characters) | Part 3.1 |
| `APNS_PRIVATE_KEY` | The text inside the `.p8` key file (paste it all) | Part 3.3 |
| `APPLE_TEAM_ID` | Same Team ID — turns on iPhone universal links | Part 3.1 |
| `ANDROID_CERT_SHA256` | SHA-256 fingerprints of your Android signing keys, comma separated | Part 2.6 |

Keep these secret. Never put them in GitHub.

---

## Part 2 — Android / Google Play

### 2.1 Accounts you need

* A **Google Play Console** developer account: <https://play.google.com/console>
  ($25 once). Choose **Personal** or **Organization**.
  * **Personal accounts created after November 2023 must run a closed test
    with at least 12 testers for 14 days in a row** before they can publish to
    everyone. Plan for this — invite friends with Android phones.
* A free **Firebase** project for notifications: <https://console.firebase.google.com>

### 2.2 Install the tools (on your computer)

* **Android Studio** (free): <https://developer.android.com/studio>. Open it once
  and let it install the Android SDK.
* **Node.js 22**: <https://nodejs.org>
* In a terminal, in this repository:

```bash
npm ci
```

```bash
npx cap sync android
```

### 2.3 Firebase (Android notifications)

1. Firebase console → **Add project** → name it "Ghostline" → you can turn
   Google Analytics off.
2. **Add app** → Android icon → Android package name
   `com.jaiprakash.ghostline` → **Register app** → **Download
   google-services.json** → put it in `android/app/google-services.json`.
   (It is safe to commit; it is not a secret. The app only asks for
   notifications when this file is present.)
3. Firebase → ⚙️ **Project settings** → **Service accounts** → **Generate new
   private key** → a `.json` file downloads. Open it, copy everything, and
   paste it into Vercel as `FIREBASE_SERVICE_ACCOUNT` (Part 1.3). This one
   **is** secret.

### 2.4 Create your upload key (once — keep it forever)

Google Play needs every update signed with the same key. Run this in a
terminal (Android Studio includes `keytool`; on Windows use the one in
`Android Studio\jbr\bin`):

```bash
keytool -genkeypair -v -keystore ghostline-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

It asks for a password and your name. **Back up `ghostline-upload.jks` and the
password** (for example in a password manager). Never commit it, never send
it to anyone. If you lose it, Google can reset it, but it takes days.

Then create `android/keystore.properties` (it is git-ignored):

```properties
storeFile=/full/path/to/ghostline-upload.jks
storePassword=your-password
keyAlias=upload
keyPassword=your-password
```

### 2.5 Build the AAB

Either in Android Studio (**Open** the `android` folder → **Build** →
**Generate Signed App Bundle / APK** → Android App Bundle), or in a terminal:

```bash
cd android && ./gradlew bundleRelease
```

The file is `android/app/build/outputs/bundle/release/app-release.aab`.

**Without a computer:** GitHub builds it too (Actions → **Mobile apps**). Add
these repository secrets (GitHub → Settings → Secrets and variables →
Actions): `ANDROID_KEYSTORE_BASE64` (the `.jks` file in base64:
`base64 -i ghostline-upload.jks`), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` (`upload`), `ANDROID_KEY_PASSWORD`, and optionally
`ANDROID_GOOGLE_SERVICES_JSON_BASE64`. Each run's **Artifacts** include
`app-release.aab` and a test `app-debug.apk` you can install directly on an
Android phone.

**Before every new upload**, raise `versionCode` (1, 2, 3 …) and
`versionName` in `android/app/build.gradle`.

### 2.6 Create the app in Play Console

1. **Create app** → name **Ghostline**, App, Free → accept the declarations.
2. **Test and release → Testing → Closed testing** (or **Internal testing**
   first) → create a release → upload `app-release.aab`. Accept **Play App
   Signing** when asked.
3. **Test and release → App integrity → App signing**: copy both **SHA-256
   certificate fingerprints** (the app signing key and the upload key) into
   Vercel as `ANDROID_CERT_SHA256`, separated by a comma. After the redeploy,
   `https://loveline.space/.well-known/assetlinks.json`
   shows them, and website links open the app.
4. Fill in **Grow users → Store presence → Main store listing**: short and
   full description, the icon (`mobile/assets/icon-only.png` is 1024×1024;
   Play wants 512×512 — export a smaller copy), a 1024×500 feature graphic,
   and at least 2 phone screenshots (plus 7" and 10" tablet ones if you list
   tablets).
5. **Policy → App content**: complete every item:
   * **Privacy policy URL**: `https://loveline.space/privacy`
   * **App access**: "All or some functionality is restricted" → give a
     **test account** (an email + password you approved in Admin) and say the
     app is invitation-only.
   * **Ads**: No. **Content rating** questionnaire. **Target audience**: 18+
     is simplest. **Data safety**: collected — email, name, user IDs,
     messages, photos/videos, audio, device ID (for notifications), precise
     location (only when someone chooses to send it in a chat); all for
     app functionality; encrypted in transit; not shared; users can ask for
     deletion. **Account deletion**: see "Store rules to know" below.
6. When the closed test has run (12 testers, 14 days for new personal
   accounts) → **Production** → create release → **Send for review**.

---

## Part 3 — iPhone / App Store

### 3.1 What you need

* A **Mac** with **Xcode 16 or newer** (free from the Mac App Store). iPhone
  apps can only be signed and uploaded from a Mac. (No Mac? Rent one, e.g.
  MacinCloud, or ask a friend for an hour.)
* An **Apple Developer Program** membership: <https://developer.apple.com/programs/>
  ($99/year). After joining, your **Team ID** is at
  <https://developer.apple.com/account> → **Membership details**. Put it in
  Vercel as `APNS_TEAM_ID` and `APPLE_TEAM_ID`.

### 3.2 Open the project

On the Mac, in this repository:

```bash
npm ci
```

```bash
npx cap sync ios
```

```bash
npx cap open ios
```

In Xcode: click **App** (blue icon, top left) → target **App** → **Signing &
Capabilities**:

* Tick **Automatically manage signing** and choose your **Team**.
* Bundle Identifier: `com.jaiprakash.ghostline` (already set).
* You should see **Push Notifications** and **Associated Domains**
  (`applinks:loveline.space`) — they come from
  `ios/App/App/App.entitlements`. If Xcode shows a red error for either,
  click **+ Capability** and add it.

Try it on your iPhone: plug it in, pick it at the top of Xcode, press ▶︎.

### 3.3 iPhone notifications key

<https://developer.apple.com/account/resources/authkeys/list> → **+** →
name "Ghostline push" → tick **Apple Push Notifications service (APNs)** →
Configure → **Sandbox & Production** → Save → **Download** the `.p8` file
(you can only download it once — back it up). Put into Vercel:

* `APNS_KEY_ID` — the Key ID shown on that page
* `APNS_PRIVATE_KEY` — open the `.p8` in a text editor and paste everything,
  including the `-----BEGIN PRIVATE KEY-----` lines

Then redeploy. The server sends to Apple's production service (App Store and
TestFlight builds) and automatically retries Apple's test service for builds
you run from Xcode.

### 3.4 Create the app in App Store Connect

<https://appstoreconnect.apple.com> → **Apps** → **+ New App** → iOS, name
**Ghostline**, language, Bundle ID `com.jaiprakash.ghostline`, SKU
`ghostline`.

### 3.5 Upload a build

In Xcode, choose **Any iOS Device (arm64)** at the top → **Product → Archive**
→ the Organizer opens → **Distribute App** → **App Store Connect** →
**Upload**. Before every new upload, raise **Version** / **Build** under
target App → **General**.

After ~15 minutes the build appears in App Store Connect → **TestFlight**,
where you and Meenu can install it with the TestFlight app before release.

### 3.6 Store listing and review

* Screenshots: 6.9" iPhone (1320×2868) is required; 13" iPad if you keep iPad
  support (it is on).
* **App Privacy**: same data as the Play "Data safety" list in 2.6 — not used
  for tracking. The app also includes a privacy manifest
  (`ios/App/App/PrivacyInfo.xcprivacy`).
* **Privacy Policy URL**: `https://loveline.space/privacy`
* **App Review Information → Sign-in required**: give a working test
  account (email + password) and explain: "Ghostline is a private,
  invitation-only messenger. Use this demo account."
* Export compliance is pre-answered (standard HTTPS only).
* **Submit for Review**.

---

## Store rules to know (please read)

* **Account deletion (both stores).** Apps that let people have accounts must
  let them start deleting their account **from inside the app**. Today only
  the admin can delete accounts. Before submitting, add a "Delete my account"
  option in Settings (ask Claude to add it) or, at minimum, a clear in-app
  link that requests deletion.
* **Sign in with Apple (App Store 4.8).** Apps that offer Google sign-in are
  usually asked to also offer an equally private option. Email + password may
  be accepted, but Apple can ask for **Sign in with Apple**. If the review
  asks, it can be added (Supabase supports it).
* **"Just a website" (App Store 4.2).** Apple rejects apps that only wrap a
  website. Ghostline has native notifications, Face ID unlock, camera,
  microphone and photo saving, which helps — mention them in the review notes.
* **Test accounts.** Both reviewers need to sign in. Keep the demo account
  approved and active, with a sample chat in it.

---

## Everyday work after publishing

* **Website changes** (most changes): just deploy to Vercel. Everyone gets
  them automatically — the website, the installed web app, and the Android and
  iPhone apps. Open tabs and apps check for a new version when they come back
  to the screen and every 5 minutes: they reload by themselves if nothing
  would be lost, or show *"A new version of Ghostline is ready · Update"* while
  someone is typing or in a dialog. No store update needed.
* **App changes** (icon, permissions, plugins, `capacitor.config.ts`, files
  in `android/` or `ios/`): run `npx cap sync`, raise the version numbers,
  build, and upload a new version to each store. Then tell older apps about it
  with these Vercel environment variables (and redeploy):

  | Name | Effect |
  | --- | --- |
  | `LATEST_ANDROID_BUILD` / `LATEST_IOS_BUILD` | Apps with a lower build number get **one** reminder: "A new version of the app is available · Update" (opens the store). |
  | `MIN_ANDROID_BUILD` / `MIN_IOS_BUILD` | Apps with a lower build number show a full-screen **"Update Ghostline"** with a button to the store, until updated. Use this only when the old app really can't work any more. |
  | `IOS_APP_STORE_ID` | The number in your App Store link (`apps.apple.com/app/id123456789` → `123456789`), so the button opens Ghostline's page directly. |

  The build number is `versionCode` in `android/app/build.gradle` and
  **Build** in Xcode (target App → General). Only raise the minimum after
  the new version is live in the store.
* **New icon or splash:** replace the images in `mobile/assets/` (or edit
  `mobile/assets/make-sources.cjs` and run it with `node`), then:

```bash
npx @capacitor/assets@4.0.0 generate --assetPath mobile/assets --iconBackgroundColor '#16161d' --iconBackgroundColorDark '#16161d' --splashBackgroundColor '#000000' --splashBackgroundColorDark '#000000'
```

* **Testing against a preview deployment** instead of the live site:

```bash
CAP_SERVER_URL=https://your-preview.vercel.app npx cap sync
```

  Run `npx cap sync` again without it before building for the stores.

## What is where

| Path | What |
| --- | --- |
| `capacitor.config.ts` | App ID, name, website URL, splash and system bar settings |
| `android/` | Android Studio project (manifest, icons, signing, Firebase) |
| `ios/` | Xcode project (Info.plist permissions, entitlements, icons) |
| `mobile/www/` | Offline page shown when there is no internet |
| `mobile/assets/` | Source images for the icon and splash |
| `src/lib/native.ts`, `src/components/native/native-bridge.tsx` | Website code that runs only inside the app |
| `src/lib/native-push.server.ts` | Sends notifications to phones (Firebase / Apple) |
| `src/app/.well-known/*` | App Links / Universal Links verification files |
| `supabase/update_native_push.sql` | The one database update for the app |
| `.github/workflows/mobile.yml` | Builds the APK, AAB and an iOS build on GitHub |

## Known differences from the website

* **Delivered ticks:** browsers mark a message ✓✓ "Delivered" when the
  notification arrives. In the phone app this happens when the app is next
  opened (the website code can't run while the app is closed).
* **Notifications inside the open app:** while Ghostline is open, new messages
  appear live in the chat instead of as a banner.
* **Saving photos:** the download button opens the share sheet — choose
  **Save Image** (iPhone) or **Save** / your gallery (Android).
* **Offline:** without internet the app shows a "You're offline" page and
  reloads by itself when the connection returns.
