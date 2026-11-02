import "server-only";

/** Must match appId in capacitor.config.ts. */
export const NATIVE_APP_ID_SERVER = "com.jaiprakash.ghostline";

/**
 * SHA-256 fingerprints of the Android signing certificates, comma separated
 * (Play Console → Test and release → App integrity → App signing). Format
 * AB:CD:…; anything else is ignored.
 */
export function androidCertFingerprints(env: string | undefined = process.env.ANDROID_CERT_SHA256): string[] {
  return (env ?? "")
    .split(/[,\s]+/)
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
}

/** The 10-character Apple Developer Team ID, or null. */
export function appleTeamId(env: string | undefined = process.env.APPLE_TEAM_ID): string | null {
  const id = (env ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(id) ? id : null;
}
