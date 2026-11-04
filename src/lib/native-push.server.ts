import "server-only";
import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import http2 from "node:http2";
import type { PushPayload } from "@/lib/push.server";

/**
 * Notifications for the Loveline Android / iOS app.
 *
 *  - Android: Firebase Cloud Messaging (HTTP v1 API). Needs the Firebase
 *    service account JSON in FIREBASE_SERVICE_ACCOUNT (plain JSON or base64).
 *  - iPhone:  Apple Push Notification service directly (token-based auth).
 *    Needs APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY (the .p8 file's
 *    text, or base64 of it). Optional: APNS_BUNDLE_ID, APNS_ENVIRONMENT.
 *
 * Without those settings, phones simply aren't notified (browsers still are).
 * Uses only Node built-ins, so nothing extra is installed.
 */

export const NATIVE_BUNDLE_ID = "com.jaiprakash.ghostline";

export type NativeSendResult = "sent" | "expired" | "failed" | "not_configured";

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** Accepts the secret as pasted (with real or "\n" line breaks) or base64-encoded. */
export function readSecret(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("{") || raw.startsWith("-----")) return raw.replace(/\\n/g, "\n");
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    return decoded.startsWith("{") || decoded.startsWith("-----") ? decoded : null;
  } catch {
    return null;
  }
}

/** Builds a signed JWT. RS256 for Google, ES256 for Apple. */
export function signJwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  privateKeyPem: string,
): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = createPrivateKey(privateKeyPem);
  const signature =
    header.alg === "ES256"
      ? cryptoSign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" })
      : cryptoSign("sha256", Buffer.from(input), key);
  return `${input}.${b64url(signature)}`;
}

// --- Firebase Cloud Messaging (Android) -------------------------------------------

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export function readServiceAccount(env = process.env.FIREBASE_SERVICE_ACCOUNT): ServiceAccount | null {
  const text = readSecret(env);
  if (!text) return null;
  try {
    const json = JSON.parse(text) as Partial<ServiceAccount>;
    if (!json.project_id || !json.client_email || !json.private_key) return null;
    return { project_id: json.project_id, client_email: json.client_email, private_key: json.private_key };
  } catch {
    return null;
  }
}

let googleToken: { value: string; expires: number; email: string } | null = null;

async function googleAccessToken(account: ServiceAccount, fetchImpl: typeof fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (googleToken && googleToken.email === account.client_email && googleToken.expires > now + 60) return googleToken.value;
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    account.private_key,
  );
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) throw new Error(`Google token request failed (${res.status})`);
  googleToken = { value: json.access_token, expires: now + (json.expires_in ?? 3600), email: account.client_email };
  return json.access_token;
}

/** The FCM v1 message for one Android phone. */
export function fcmMessage(token: string, payload: PushPayload) {
  return {
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      data: { url: payload.url, tag: payload.tag },
      android: {
        priority: "HIGH",
        collapse_key: payload.tag.slice(0, 64),
        ttl: "86400s",
        notification: {
          channel_id: "messages",
          tag: payload.tag,
          sound: "default",
          ...(payload.vibrate
            ? { vibrate_timings: payload.vibrate.map((ms) => `${(ms / 1000).toFixed(3)}s`), default_vibrate_timings: false }
            : { default_vibrate_timings: true }),
        },
      },
    },
  };
}

export async function sendFcm(
  token: string,
  payload: PushPayload,
  fetchImpl: typeof fetch = fetch,
  account = readServiceAccount(),
): Promise<NativeSendResult> {
  if (!account) return "not_configured";
  const access = await googleAccessToken(account, fetchImpl);
  const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
    body: JSON.stringify(fcmMessage(token, payload)),
  });
  if (res.ok) return "sent";
  const err = (await res.json().catch(() => ({}))) as {
    error?: { status?: string; details?: Array<{ errorCode?: string }> };
  };
  const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status;
  // The app was uninstalled or the token rotated.
  if (res.status === 404 || code === "UNREGISTERED") return "expired";
  throw new Error(`FCM send failed (${res.status} ${code ?? ""})`);
}

// --- Apple Push Notification service (iPhone) ---------------------------------------

interface ApnsConfig {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
  environment: "production" | "development";
}

export function readApnsConfig(env: Record<string, string | undefined> = process.env): ApnsConfig | null {
  const privateKey = readSecret(env.APNS_PRIVATE_KEY);
  const keyId = (env.APNS_KEY_ID ?? "").trim();
  const teamId = (env.APNS_TEAM_ID ?? env.APPLE_TEAM_ID ?? "").trim();
  if (!privateKey || !/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId)) return null;
  return {
    keyId,
    teamId,
    privateKey,
    bundleId: (env.APNS_BUNDLE_ID ?? "").trim() || NATIVE_BUNDLE_ID,
    environment: env.APNS_ENVIRONMENT === "development" ? "development" : "production",
  };
}

let appleToken: { value: string; issued: number; keyId: string } | null = null;

function apnsJwt(config: ApnsConfig): string {
  const now = Math.floor(Date.now() / 1000);
  // Apple wants the token refreshed between 20 and 60 minutes.
  if (appleToken && appleToken.keyId === config.keyId && now - appleToken.issued < 40 * 60) return appleToken.value;
  const value = signJwt({ alg: "ES256", kid: config.keyId }, { iss: config.teamId, iat: now }, config.privateKey);
  appleToken = { value, issued: now, keyId: config.keyId };
  return value;
}

/** The APNs JSON body for one iPhone. */
export function apnsBody(payload: PushPayload) {
  return {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      "thread-id": payload.tag,
    },
    url: payload.url,
    tag: payload.tag,
  };
}

interface ApnsResponse {
  status: number;
  reason?: string;
}

export type ApnsTransport = (host: string, path: string, headers: Record<string, string>, body: string) => Promise<ApnsResponse>;

const http2Transport: ApnsTransport = (host, path, headers, body) =>
  new Promise((resolve, reject) => {
    const session = http2.connect(`https://${host}`);
    session.on("error", reject);
    const req = session.request({ ":method": "POST", ":path": path, ...headers });
    req.setTimeout(10_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
    let status = 0;
    let data = "";
    req.on("response", (h) => (status = Number(h[":status"])));
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (data += chunk));
    req.on("end", () => {
      session.close();
      let reason: string | undefined;
      try {
        reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined;
      } catch {
        reason = undefined;
      }
      resolve({ status, reason });
    });
    req.on("error", (err) => {
      session.close();
      reject(err);
    });
    req.end(body);
  });

const APNS_HOST = { production: "api.push.apple.com", development: "api.sandbox.push.apple.com" } as const;

export async function sendApns(
  deviceToken: string,
  payload: PushPayload,
  transport: ApnsTransport = http2Transport,
  config = readApnsConfig(),
): Promise<NativeSendResult> {
  if (!config) return "not_configured";
  const headers = {
    authorization: `bearer ${apnsJwt(config)}`,
    "apns-topic": config.bundleId,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "apns-expiration": String(Math.floor(Date.now() / 1000) + 86_400),
    "apns-collapse-id": payload.tag.slice(0, 64),
    "content-type": "application/json",
  };
  const body = JSON.stringify(apnsBody(payload));
  const path = `/3/device/${deviceToken}`;
  let res = await transport(APNS_HOST[config.environment], path, headers, body);
  // Builds run from Xcode use Apple's test servers; App Store / TestFlight builds use production.
  if (res.status === 400 && res.reason === "BadDeviceToken" && config.environment === "production") {
    res = await transport(APNS_HOST.development, path, headers, body);
  }
  if (res.status === 200) return "sent";
  if (res.status === 410 || res.reason === "BadDeviceToken" || res.reason === "Unregistered") return "expired";
  throw new Error(`APNs send failed (${res.status} ${res.reason ?? ""})`);
}

/** Sends to a stored endpoint ('fcm:<token>' or 'apns:<token>'). */
export async function sendNative(endpoint: string, payload: PushPayload): Promise<NativeSendResult> {
  const sep = endpoint.indexOf(":");
  const provider = endpoint.slice(0, sep);
  const token = endpoint.slice(sep + 1);
  if (provider === "fcm") return sendFcm(token, payload);
  if (provider === "apns") return sendApns(token, payload);
  return "failed";
}

export function isNativeEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("fcm:") || endpoint.startsWith("apns:");
}
