# Ghostline Plus — subscriptions

Ghostline Plus is a paid tier that unlocks the **couple pack**: journal,
bucket list, date planner, special dates and love-notes scheduling. Everything
else stays free. In a one-to-one chat, **if either partner has Plus, both get
the couple pack.**

This guide sets up real payments. Until you do, the app already works: an
**administrator can grant Plus for free** (Admin → member → **Grant Plus**),
which is enough to use and test everything.

## How it fits together

| Where people pay | System | Who keeps what |
| --- | --- | --- |
| The website (browser) | **Stripe** | ~97% (Stripe fee only) |
| The iPhone app | **Apple In-App Purchase** (via RevenueCat) | 70–85% (Apple's cut) |
| The Android app | **Google Play Billing** (via RevenueCat) | 70–85% (Google's cut) |

**You must use Apple/Google billing inside the apps** — Apple and Google don't
allow card forms or Stripe for digital subscriptions in a store app, and will
reject the app. The website can use Stripe. One tool, **RevenueCat**, handles
the Apple + Google side so the app has a single "buy" button.

All of them end up in the same place: a webhook tells Ghostline's server, which
updates the `subscriptions` table. The app then reads one answer — "is this
person Plus?" — everywhere.

```
Website  → Stripe Checkout ───→ /api/webhooks/stripe ─────┐
iPhone   → Apple IAP  ┐                                    ├─→ subscriptions table → is_plus
Android  → Play Billing├→ RevenueCat → /api/webhooks/revenuecat ┘
Admin grant (free) ───────────────→ admin_set_plus ───────┘
```

## Part 0 — Database (required)

Supabase → **SQL Editor** → run `supabase/update_subscriptions.sql` once. (New
projects created from `setup_all.sql` already have it.)

## Part 1 — Website payments (Stripe)

1. Create a **Stripe** account: <https://dashboard.stripe.com>
2. **Product catalog → Add product** → "Ghostline Plus", recurring, monthly,
   set your price → save. Copy the **Price ID** (`price_…`).
3. **Developers → API keys** → copy the **Secret key** (`sk_live_…`, or
   `sk_test_…` while testing).
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://loveline.space/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Save, then copy the **Signing secret** (`whsec_…`).
5. Vercel → **Settings → Environment Variables** (tick **Production** and
   **Preview**), then redeploy:

   | Name | Value |
   | --- | --- |
   | `STRIPE_SECRET_KEY` | `sk_…` (mark Sensitive) |
   | `STRIPE_PRICE_ID` | `price_…` |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_…` (mark Sensitive) |
   | `NEXT_PUBLIC_PLUS_PRICE` | The label shown on the paywall, e.g. `$4.99 / month` |

Now the website's **Subscribe** button opens Stripe Checkout, and a completed
payment turns on Plus automatically. Test with Stripe's test card
`4242 4242 4242 4242`, any future date and CVC, while using the `sk_test_…` key.

## Part 2 — App payments (RevenueCat → Apple & Google)

Do this after your apps exist in the stores (see `docs/MOBILE_PUBLISHING.md`).

1. **App Store Connect** → your app → **Subscriptions** → create a subscription
   group and a monthly product (note its **Product ID**, e.g.
   `ghostline_plus_monthly`).
2. **Google Play Console** → your app → **Monetize → Subscriptions** → create
   the same product with the same Product ID.
3. **RevenueCat** (<https://www.revenuecat.com>, free to start):
   - Add the app for Apple and for Google, connect them with the keys each
     store gives you.
   - Create an **Entitlement** called `plus` and attach both store products to
     an **Offering**.
   - **Integrations → Webhooks → Add**: URL
     `https://loveline.space/api/webhooks/revenuecat`,
     and set an **Authorization header** value (any long random string).
   - Copy RevenueCat's **public SDK keys** (one for Apple, one for Google).
4. Vercel environment variables (then redeploy):

   | Name | Value |
   | --- | --- |
   | `REVENUECAT_WEBHOOK_SECRET` | The Authorization value you set in RevenueCat |
   | `NEXT_PUBLIC_REVENUECAT_IOS_KEY` | RevenueCat public key for Apple |
   | `NEXT_PUBLIC_REVENUECAT_ANDROID_KEY` | RevenueCat public key for Google |

5. The in-app purchase button needs the RevenueCat SDK wired into the app. Ask
   Claude to "turn on in-app purchases with RevenueCat" once the keys above
   exist — it adds the plugin and connects `startSubscribe()` to it. Until
   then, the app tells users to subscribe on the website or ask the admin.

   > **Important (RevenueCat app user id):** the app must identify each buyer to
   > RevenueCat by their Ghostline user id (`access.user_id`). That id is what
   > the webhook reads as `app_user_id`, so the right account gets Plus.

## Granting Plus for free (anytime)

Admin → **Members & access** → next to a registered member → **Grant Plus** (or
**Remove Plus**). Use this for the two of you, for testers, or for comps. It's
recorded in the audit log and never expires unless you remove it.

## What's in the code

| Path | What |
| --- | --- |
| `supabase/update_subscriptions.sql` | The `subscriptions` table, `is_plus` / `conversation_is_plus` helpers, `admin_set_plus`, and `server_apply_subscription` (service-only) |
| `src/lib/plus.ts` | The paywall copy and the web "start subscribing" flow |
| `src/components/plus/` | The paywall dialog and the Settings card |
| `src/lib/billing.server.ts` | Turns Stripe / RevenueCat webhooks into one update (signature-checked) |
| `src/app/api/billing/checkout` | Creates the Stripe Checkout session |
| `src/app/api/webhooks/stripe`, `.../revenuecat` | Receive events and update the table |

## Store rules to remember

- **Account deletion** must be possible in-app (both stores) before you ship.
- On iOS you **cannot** point users from the app to the website to pay for the
  same thing (anti-steering). Keep the app's purchase on Apple IAP; the website
  stands on its own.
- A subscription with a free trial, intro price or auto-renew must show the
  terms clearly on the paywall before purchase — adjust `src/lib/plus.ts` copy
  if you add those.
