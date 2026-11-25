import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/env";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Private, invitation-only messaging.",
    start_url: "/chat",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#120b11",
    theme_color: "#120b11",
    categories: ["social", "communication"],
    icons: [
      { src: "/icons/icon-192.png?v=rose", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png?v=rose", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png?v=rose", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
