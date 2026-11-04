import { NATIVE_APP_ID_SERVER, androidCertFingerprints } from "@/lib/native-links.server";

/**
 * Android App Links: proves to Android that the Loveline app may open links
 * to this website. Off (404) until ANDROID_CERT_SHA256 is set in Vercel.
 */
export function GET() {
  const fingerprints = androidCertFingerprints();
  if (fingerprints.length === 0) return new Response("Not found", { status: 404 });
  return Response.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: NATIVE_APP_ID_SERVER, sha256_cert_fingerprints: fingerprints },
      },
    ],
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
