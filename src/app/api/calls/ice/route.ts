import { createHmac } from "node:crypto";
import { getAccess } from "@/lib/access";

export async function GET() {
  const member = await getAccess();
  if (!member?.is_active || member.must_change_password) return new Response(null, { status: 403 });
  const urls = process.env.CALL_TURN_URLS?.split(",").map(value => value.trim()).filter(Boolean);
  const secret = process.env.CALL_TURN_SECRET;
  const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  if (urls?.length || secret) {
    if (!secret || !urls?.length || urls.some(url => !/^turns?:/i.test(url))) {
      return new Response(null, { status: 503 });
    }
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${member.user_id}`;
    iceServers.push({ urls, username, credential: createHmac("sha1", secret).update(username).digest("base64") });
  }
  return Response.json({ iceServers }, { headers: { "Cache-Control": "private, no-store" } });
}
