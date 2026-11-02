"use client";

/**
 * "Send my location": a one-off pin, sent as an ordinary text message
 *   📍 Location
 *   https://www.google.com/maps/search/?api=1&query=12.971600,77.594600
 * so notifications, previews and older versions of the app all show something
 * sensible. The chat recognises this exact shape and draws a map card.
 */
import { isNativeApp, nativePlatform } from "@/lib/native";

export interface SharedLocation {
  lat: number;
  lng: number;
}

const BODY_RE =
  /^📍 Location\nhttps:\/\/www\.google\.com\/maps\/search\/\?api=1&query=(-?\d{1,2}\.\d{1,7}),(-?\d{1,3}\.\d{1,7})$/;

export function locationMessage({ lat, lng }: SharedLocation): string {
  return `📍 Location\nhttps://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** The location in a message, or null if the message isn't a location. */
export function parseLocation(body: string | null | undefined): SharedLocation | null {
  const m = BODY_RE.exec(body ?? "");
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Apple Maps on iPhone, Google Maps everywhere else. */
export function mapsUrl({ lat, lng }: SharedLocation, platform: "ios" | "android" | "web" = nativePlatform()): string {
  const q = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return platform === "ios"
    ? `https://maps.apple.com/?ll=${q}&q=${encodeURIComponent("Shared location")}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export class LocationError extends Error {}

/**
 * Asks for permission (the phone's own prompt in the app, the browser's on the
 * web) and reads the current position.
 */
export async function getCurrentLocation(): Promise<SharedLocation & { accuracy: number }> {
  if (isNativeApp()) {
    const { Geolocation } = await import("@capacitor/geolocation");
    let status = await Geolocation.checkPermissions().catch(() => null);
    if (!status || status.location === "prompt" || status.location === "prompt-with-rationale") {
      status = await Geolocation.requestPermissions({ permissions: ["location"] }).catch(() => null);
    }
    if (status?.location === "denied") {
      throw new LocationError("Location is off for Ghostline. Turn it on in your phone's Settings → Ghostline → Location.");
    }
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    } catch {
      throw new LocationError("Couldn't find your location. Check that Location is on and try again.");
    }
  }
  if (!("geolocation" in navigator)) throw new LocationError("This browser can't share your location.");
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) =>
        reject(
          new LocationError(
            err.code === err.PERMISSION_DENIED
              ? "Location is blocked for this site. Allow it in your browser settings and try again."
              : "Couldn't find your location. Check that Location is on and try again.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}
