import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : "";
const supabaseWs = supabaseOrigin.replace(/^http/, "ws");

// Razorpay Checkout (UPI / Google Pay / cards) loads a script and opens an
// iframe, so its origins are allowed in the CSP only when Razorpay is turned on.
const rzpOn = Boolean(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID);
const rzp = rzpOn ? "https://*.razorpay.com" : "";
const rzpScript = rzpOn ? "https://checkout.razorpay.com" : "";

// Content Security Policy: only this origin and the Supabase project may be
// contacted. 'unsafe-inline' for styles is required by Next.js/Radix inline
// style attributes; scripts use 'unsafe-inline' only because Next.js injects
// inline bootstrap scripts without a nonce in static rendering.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} ${rzpScript}`,
  "style-src 'self' 'unsafe-inline'",
  // googleusercontent.com: Google profile pictures shown on access requests.
  `img-src 'self' blob: data: ${supabaseOrigin} https://*.googleusercontent.com https://*.giphy.com ${rzp}`,
  "font-src 'self'",
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs} ${rzp}`,
  // Razorpay Checkout opens its payment window in an iframe.
  ...(rzpOn ? [`frame-src 'self' ${rzp}`] : []),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action 'self' ${rzp}`,
  "object-src 'none'",
  "worker-src 'self'",
  `media-src 'self' blob: ${supabaseOrigin}`,
  "manifest-src 'self'",
]
  .map((d) => d.replace(/\s+/g, " ").trim())
  .join("; ");

// Identifies this deployment, so open tabs and apps can tell a newer one is live
// (see src/lib/app-version.ts). Vercel provides the git commit.
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || process.env.VERCEL_DEPLOYMENT_ID || `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // The dev-only badge sits on top of the bottom-left "+" button.
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Always fetch the newest service worker so app updates reach installed devices.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
