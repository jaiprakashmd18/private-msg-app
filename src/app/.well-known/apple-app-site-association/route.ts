import { NATIVE_APP_ID_SERVER, appleTeamId } from "@/lib/native-links.server";

/**
 * iOS Universal Links: proves to iOS that the Ghostline app may open links to
 * chats on this website. Off (404) until APPLE_TEAM_ID is set in Vercel.
 */
export function GET() {
  const team = appleTeamId();
  if (!team) return new Response("Not found", { status: 404 });
  const appID = `${team}.${NATIVE_APP_ID_SERVER}`;
  return Response.json(
    {
      applinks: {
        details: [{ appIDs: [appID], components: [{ "/": "/chat*" }, { "/": "/settings*" }] }],
      },
      webcredentials: { apps: [appID] },
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
