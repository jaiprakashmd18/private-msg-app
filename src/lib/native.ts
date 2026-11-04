"use client";

/**
 * Everything the website does differently when it runs inside the Loveline
 * Android / iOS app (Capacitor). In a normal browser every function here is a
 * no-op or returns "not native", so the website behaves exactly as before.
 *
 * Plugins are loaded on demand, so browsers never download them.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The app's id; also its URL scheme (com.jaiprakash.ghostline://…). */
export const NATIVE_APP_ID = "com.jaiprakash.ghostline";
export const NATIVE_AUTH_CALLBACK = `${NATIVE_APP_ID}://auth/callback`;

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function nativePlatform(): "ios" | "android" | "web" {
  const p = isNativeApp() ? Capacitor.getPlatform() : "web";
  return p === "ios" || p === "android" ? p : "web";
}

// --- Google sign-in ------------------------------------------------------------

/**
 * Google refuses to show its sign-in page inside apps, so the app opens it in
 * the system's secure browser window (Custom Tabs / Safari view). Google and
 * Supabase then send the browser to com.jaiprakash.ghostline://auth/callback,
 * which reopens the app; NativeBridge finishes the sign-in on the website's
 * normal /auth/callback page (where the PKCE verifier cookie lives).
 */
export async function nativeGoogleSignIn(supabase: SupabaseClient): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: NATIVE_AUTH_CALLBACK,
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error("Google sign-in is not available right now.");
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: data.url, presentationStyle: "popover", toolbarColor: "#000000" });
}

/**
 * Turns an incoming app link into a page of the website, or null to ignore it.
 *   com.jaiprakash.ghostline://auth/callback?code=… → /auth/callback?code=…
 *   com.jaiprakash.ghostline://chat/123            → /chat/123
 *   https://<this site>/chat/123                   → /chat/123
 */
export function pathForAppUrl(rawUrl: string, siteOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  let path: string;
  if (url.protocol === `${NATIVE_APP_ID}:`) {
    // For custom schemes the first path part is parsed as the host.
    path = `/${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } else if (url.origin === siteOrigin) {
    path = url.pathname;
  } else {
    return null;
  }
  path = path.replace(/\/{2,}/g, "/");
  const allowed = ["/auth/callback", "/chat", "/settings", "/login"];
  if (!allowed.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return `${path}${url.search}`;
}

// --- Push notifications ----------------------------------------------------------

interface GhostlinePlugin {
  info(): Promise<{ pushAvailable: boolean }>;
}
const LovelinePlugin = registerPlugin<GhostlinePlugin>("Ghostline");

const TOKEN_KEY = "native-push-token";

/** "fcm" (Android, via Firebase) or "apns" (iPhone, Apple directly). */
function pushProvider(): "fcm" | "apns" {
  return nativePlatform() === "ios" ? "apns" : "fcm";
}

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(endpoint: string | null) {
  try {
    if (endpoint) localStorage.setItem(TOKEN_KEY, endpoint);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the token is just re-registered next time.
  }
}

/**
 * Android needs Firebase's google-services.json built into the app; without it
 * asking for a token would crash, so this says no. iPhone always can.
 */
export async function nativePushAvailable(): Promise<boolean> {
  if (!isNativeApp()) return false;
  if (nativePlatform() === "ios") return true;
  try {
    return (await LovelinePlugin.info()).pushAvailable;
  } catch {
    return false;
  }
}

export type NativePermission = "granted" | "denied" | "prompt";

export async function nativePushPermission(): Promise<NativePermission> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const { receive } = await PushNotifications.checkPermissions();
  return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
}

/** True when this device is registered for notifications. */
export async function nativePushEnabled(): Promise<boolean> {
  return Boolean(storedToken()) && (await nativePushPermission()) === "granted";
}

let pendingToken: { resolve: (token: string) => void; reject: (err: Error) => void } | null = null;
let listenersReady: Promise<void> | null = null;
let onTokenRefresh: ((token: string) => void) | null = null;

function ensurePushListeners(): Promise<void> {
  listenersReady ??= (async () => {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.addListener("registration", ({ value }) => {
      if (pendingToken) {
        pendingToken.resolve(value);
        pendingToken = null;
      } else {
        onTokenRefresh?.(value);
      }
    });
    await PushNotifications.addListener("registrationError", (err) => {
      pendingToken?.reject(new Error(err.error || "Could not register for notifications."));
      pendingToken = null;
    });
    if (nativePlatform() === "android") {
      // Heads-up notifications with sound and vibration, like other messengers.
      await PushNotifications.createChannel({
        id: "messages",
        name: "Messages",
        description: "New messages, love taps and reminders",
        importance: 5,
        visibility: 0,
        vibration: true,
        lights: true,
        lightColor: "#0A84FF",
      }).catch(() => undefined);
    }
  })();
  return listenersReady;
}

async function requestToken(): Promise<string> {
  await ensurePushListeners();
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const token = new Promise<string>((resolve, reject) => {
    pendingToken = { resolve, reject };
    setTimeout(() => {
      if (pendingToken) {
        pendingToken.reject(new Error("Notifications took too long to set up. Check your connection and try again."));
        pendingToken = null;
      }
    }, 20_000);
  });
  await PushNotifications.register();
  return token;
}

async function saveToken(supabase: SupabaseClient, token: string, showPreview: boolean) {
  const { error } = await supabase.rpc("save_native_push_token", {
    p_provider: pushProvider(),
    p_token: token,
    p_show_preview: showPreview,
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
  const endpoint = `${pushProvider()}:${token}`;
  const previous = storedToken();
  storeToken(endpoint);
  // The phone handed out a new token: forget the old one.
  if (previous && previous !== endpoint) {
    await supabase.rpc("delete_push_subscription", { p_endpoint: previous });
  }
}

/** Asks for permission (from a tap) and registers this phone. */
export async function enableNativePush(supabase: SupabaseClient, showPreview: boolean): Promise<void> {
  if (!(await nativePushAvailable())) {
    throw new Error("Notifications aren't set up in this version of the app yet.");
  }
  const { PushNotifications } = await import("@capacitor/push-notifications");
  let { receive } = await PushNotifications.checkPermissions();
  if (receive === "prompt" || receive === "prompt-with-rationale") {
    ({ receive } = await PushNotifications.requestPermissions());
  }
  if (receive !== "granted") {
    throw new Error("Notifications are blocked for Loveline. Allow them in your phone's Settings → Loveline → Notifications.");
  }
  await saveToken(supabase, await requestToken(), showPreview);
}

export async function updateNativePushPreview(supabase: SupabaseClient, showPreview: boolean): Promise<void> {
  const endpoint = storedToken();
  if (!endpoint) return;
  const token = endpoint.slice(endpoint.indexOf(":") + 1);
  await saveToken(supabase, token, showPreview);
}

/** Removes this phone from the account (used when turning off and on sign-out). */
export async function disableNativePush(supabase: SupabaseClient): Promise<void> {
  if (!isNativeApp()) return;
  const endpoint = storedToken();
  storeToken(null);
  if (endpoint) await supabase.rpc("delete_push_subscription", { p_endpoint: endpoint });
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.unregister();
  } catch {
    // Already unregistered.
  }
}

/**
 * On every app start: if notifications are on, refresh the token (phones
 * rotate them) and keep listening for later changes.
 */
export async function refreshNativePush(supabase: SupabaseClient, showPreview: boolean): Promise<void> {
  if (!storedToken() || !(await nativePushAvailable())) return;
  if ((await nativePushPermission()) !== "granted") return;
  onTokenRefresh = (token) => void saveToken(supabase, token, showPreview).catch(() => undefined);
  await saveToken(supabase, await requestToken(), showPreview);
}

// --- Face ID / fingerprint ----------------------------------------------------------

/** Marker stored as the app lock's "credential" when the phone's own biometrics are used. */
export const NATIVE_BIOMETRIC_ID = "native";

export async function nativeBiometricsAvailable(): Promise<boolean> {
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    const result = await BiometricAuth.checkBiometry();
    return result.isAvailable || result.deviceIsSecure;
  } catch {
    return false;
  }
}

export async function nativeBiometricVerify(reason: string): Promise<boolean> {
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "Use PIN",
      allowDeviceCredential: true,
      androidTitle: "Unlock Loveline",
      androidSubtitle: reason,
      androidConfirmationRequired: false,
    });
    return true;
  } catch {
    return false;
  }
}

// --- Saving photos ------------------------------------------------------------------

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Downloads a file and opens the phone's share sheet, where "Save Image" /
 * "Save to Files" / "Save to device" keep a copy.
 */
export async function nativeSaveFile(url: string, fileName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not download the file.");
  const data = await blobToBase64(await res.blob());
  const { Directory, Filesystem } = await import("@capacitor/filesystem");
  const safeName = fileName.replace(/[^\w.\- ]+/g, "_").slice(-100) || "ghostline-photo.jpg";
  const { uri } = await Filesystem.writeFile({ path: safeName, data, directory: Directory.Cache });
  const { Share } = await import("@capacitor/share");
  await Share.share({ files: [uri], dialogTitle: "Save or share" });
}

/** Opens a link in the system browser (outside the app). */
export async function openExternal(url: string): Promise<void> {
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url, presentationStyle: "popover" });
}
