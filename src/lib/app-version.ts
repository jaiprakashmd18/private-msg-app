/**
 * Keeping everyone on the latest version.
 *
 * Website changes reach the web, the installed web app and the Android / iOS
 * apps (which open the website) as soon as Vercel deploys them; open tabs and
 * apps notice the new build and reload. Changes to the native apps themselves
 * need a store update: /api/version tells old apps to update (required) or
 * that an update is available (optional).
 */

/** This build's id (the git commit on Vercel). Same value on server and client. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

export const ANDROID_PACKAGE = "com.jaiprakash.ghostline";

export interface StoreInfo {
  /** Below this native build number the app must be updated from the store. */
  min: number;
  /** Newest build in the store; older apps get a gentle reminder. */
  latest: number;
  url: string;
}

export interface VersionInfo {
  build: string;
  android: StoreInfo;
  ios: StoreInfo;
}

function intEnv(value: string | undefined, fallback = 0): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** What /api/version returns, from Vercel environment variables. */
export function versionInfo(env: Record<string, string | undefined> = process.env): VersionInfo {
  const iosId = (env.IOS_APP_STORE_ID ?? "").replace(/\D/g, "");
  return {
    build: BUILD_ID,
    android: {
      min: intEnv(env.MIN_ANDROID_BUILD),
      latest: intEnv(env.LATEST_ANDROID_BUILD),
      url: `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`,
    },
    ios: {
      min: intEnv(env.MIN_IOS_BUILD),
      latest: intEnv(env.LATEST_IOS_BUILD),
      url: iosId ? `https://apps.apple.com/app/id${iosId}` : "https://apps.apple.com/search?term=Ghostline",
    },
  };
}

/**
 * A new website build is out. Reload by itself when that interrupts nothing
 * (the page was in the background, nobody is typing or in a dialog);
 * otherwise offer an "Update" button.
 */
export function websiteUpdateAction(state: {
  serverBuild: string | null | undefined;
  clientBuild: string;
  returningToApp: boolean;
  busy: boolean;
}): "none" | "reload" | "prompt" {
  if (!state.serverBuild || state.serverBuild === state.clientBuild) return "none";
  return state.returningToApp && !state.busy ? "reload" : "prompt";
}

/** Whether this phone's app needs (or could use) a store update. */
export function storeUpdateNeeded(nativeBuild: number, store: StoreInfo): "required" | "available" | null {
  if (!Number.isFinite(nativeBuild) || nativeBuild <= 0) return null;
  if (store.min > 0 && nativeBuild < store.min) return "required";
  if (store.latest > 0 && nativeBuild < store.latest) return "available";
  return null;
}
