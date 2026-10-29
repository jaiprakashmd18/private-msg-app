"use client";

import { disablePush } from "@/lib/pwa-client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Signs out on the server (clears cookies, logs the event) and locally. */
export async function signOut(everywhere = false) {
  // Stop this device receiving notifications for the account being signed out.
  await Promise.race([
    disablePush(getSupabaseBrowserClient()).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  try {
    await fetch("/api/auth/signout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ everywhere }),
    });
  } finally {
    await getSupabaseBrowserClient().auth.signOut({ scope: "local" }).catch(() => undefined);
    // Full reload on purpose: drops all in-memory chat state and realtime sockets.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
}
