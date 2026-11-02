import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Static app files (service worker, manifest, icons, offline page, mobile app-link files) stay public.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sw.js|manifest.webmanifest|offline.html|icons/|\\.well-known/).*)",
  ],
};
