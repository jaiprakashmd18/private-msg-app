/**
 * App lock: a PIN (and optionally Face ID / fingerprint) that hides the app
 * on this device until unlocked. It is a privacy screen against someone
 * picking up an unlocked phone — not encryption: the settings live in this
 * browser's storage, and anyone who can sign in again can reset them.
 *
 * Stored per user in localStorage. The PIN itself is never stored, only a
 * salted PBKDF2-SHA-256 hash.
 */

export interface LockConfig {
  v: 1;
  salt: string;
  hash: string;
  iterations: number;
  pinLength: number;
  /** 0 = lock as soon as the app goes to the background. */
  timeoutMs: number;
  /** WebAuthn credential (platform authenticator) for Face ID / fingerprint. */
  credentialId?: string;
}

export const LOCK_COOKIE = "app_lock";
export const LOCK_TIMEOUTS = [
  { ms: 0, label: "Immediately" },
  { ms: 60_000, label: "After 1 minute" },
  { ms: 5 * 60_000, label: "After 5 minutes" },
  { ms: 15 * 60_000, label: "After 15 minutes" },
  { ms: 60 * 60_000, label: "After 1 hour" },
] as const;

const PBKDF2_ITERATIONS = 210_000;
const key = (userId: string) => `app-lock:v1:${userId}`;
const failKey = (userId: string) => `app-lock:fails:${userId}`;

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64Url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string) => fromB64(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export async function hashPin(pin: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    256,
  );
  return toB64(new Uint8Array(bits));
}

export async function createLockConfig(pin: string, timeoutMs: number): Promise<LockConfig> {
  if (!isValidPin(pin)) throw new Error("Use 4 to 6 digits");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    v: 1,
    salt: toB64(salt),
    hash: await hashPin(pin, salt),
    iterations: PBKDF2_ITERATIONS,
    pinLength: pin.length,
    timeoutMs,
  };
}

/** Compares in constant time (per character), so timing reveals nothing. */
export async function verifyPin(config: LockConfig, pin: string): Promise<boolean> {
  const candidate = await hashPin(pin, fromB64(config.salt), config.iterations);
  if (candidate.length !== config.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ config.hash.charCodeAt(i);
  return diff === 0;
}

// --- Storage ------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadLock(userId: string): LockConfig | null {
  try {
    const raw = storage()?.getItem(key(userId));
    const parsed = raw ? (JSON.parse(raw) as LockConfig) : null;
    return parsed?.v === 1 && parsed.hash ? parsed : null;
  } catch {
    return null;
  }
}

function setCookie(on: boolean) {
  document.cookie = on
    ? `${LOCK_COOKIE}=1; path=/; max-age=31536000; samesite=lax`
    : `${LOCK_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function saveLock(userId: string, config: LockConfig): void {
  storage()?.setItem(key(userId), JSON.stringify(config));
  setCookie(true);
  window.dispatchEvent(new Event("app-lock-changed"));
}

export function clearLock(userId: string): void {
  storage()?.removeItem(key(userId));
  storage()?.removeItem(failKey(userId));
  setCookie(false);
  window.dispatchEvent(new Event("app-lock-changed"));
}

// --- Wrong PIN back-off -------------------------------------------------------

/** After 5 wrong PINs: wait 30 s, then 1 min, 2 min … up to 15 min. */
export function backoffMs(failures: number): number {
  if (failures < 5) return 0;
  return Math.min(30_000 * 2 ** (failures - 5), 15 * 60_000);
}

export function readFailures(userId: string): { count: number; until: number } {
  try {
    const raw = storage()?.getItem(failKey(userId));
    return raw ? (JSON.parse(raw) as { count: number; until: number }) : { count: 0, until: 0 };
  } catch {
    return { count: 0, until: 0 };
  }
}

export function recordFailure(userId: string, now = Date.now()): { count: number; until: number } {
  const count = readFailures(userId).count + 1;
  const next = { count, until: now + backoffMs(count) };
  storage()?.setItem(failKey(userId), JSON.stringify(next));
  return next;
}

export function resetFailures(userId: string): void {
  storage()?.removeItem(failKey(userId));
}

// --- Face ID / fingerprint (WebAuthn platform authenticator) -----------------

export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (
      typeof PublicKeyCredential !== "undefined" &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

/**
 * Registers this device's Face ID / fingerprint / device PIN for unlocking.
 * The device keeps the private key; the app only remembers the credential id.
 * Must be called from a tap (browsers require a user gesture).
 */
export async function registerBiometrics(user: { email: string; name: string }, appName: string): Promise<string> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: appName, id: window.location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: user.email, displayName: user.name || user.email },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Face ID / fingerprint wasn't set up");
  return toB64Url(new Uint8Array(credential.rawId));
}

/** Asks the device to verify the user (Face ID, fingerprint or device PIN). */
export async function verifyBiometrics(credentialId: string): Promise<boolean> {
  try {
    const result = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        allowCredentials: [{ type: "public-key", id: fromB64Url(credentialId), transports: ["internal"] }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return result !== null;
  } catch {
    return false;
  }
}
