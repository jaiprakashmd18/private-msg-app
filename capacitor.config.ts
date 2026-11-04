import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Ghostline for Android and iOS.
 *
 * The app shows the live website (server.url) inside a native shell, so the
 * website, Supabase backend, accounts and realtime messaging stay exactly as
 * they are. Everything native (Google sign-in window, push notifications,
 * back button, Face ID / fingerprint, saving photos) is wired up by
 * src/components/native/native-bridge.tsx, which only runs inside the app.
 *
 * To try a Vercel preview build instead of production:
 *   CAP_SERVER_URL=https://<preview>.vercel.app npx cap sync
 */
const SERVER_URL = process.env.CAP_SERVER_URL ?? "https://loveline.space";

const config: CapacitorConfig = {
  appId: "com.jaiprakash.ghostline",
  appName: "Ghostline",
  // Only the offline page lives in the app; everything else loads from SERVER_URL.
  webDir: "mobile/www",
  backgroundColor: "#000000",
  appendUserAgent: "GhostlineApp",
  server: {
    url: SERVER_URL,
    // Shown when the website can't be reached (no internet).
    errorPath: "offline.html",
  },
  android: {
    allowMixedContent: false,
    // Chrome-based WebView 100+ (Android 7+ with updates); older ones see the offline page.
    minWebViewVersion: 100,
  },
  ios: {
    // The website handles the notch and home indicator itself (viewport-fit=cover).
    contentInset: "never",
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      backgroundColor: "#000000",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
    },
    SystemBars: {
      // Edge-to-edge with correct env(safe-area-inset-*) values, like the installed web app.
      insetsHandling: "native",
      initialViewportFitValueHint: "cover",
      style: "DARK",
    },
    PushNotifications: {
      // While the app is open, new messages already appear live in the chat.
      presentationOptions: [],
    },
  },
};

export default config;
