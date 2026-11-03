"use client";

import { MapPin, Navigation } from "lucide-react";
import { mapsUrl, type SharedLocation } from "@/lib/location";
import { cn } from "@/lib/utils";

/**
 * A shared location in the chat. Draws a simple map-style tile locally (no map
 * service sees where you are) and opens the phone's maps app when tapped.
 */
export function LocationCard({ location, mine }: { location: SharedLocation; mine: boolean }) {
  const coords = `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`;
  return (
    <a
      href={mapsUrl(location)}
      target="_blank"
      rel="noopener noreferrer"
      data-open="system"
      aria-label={`Shared location ${coords}. Open in Maps`}
      className="-mx-3 -my-1.5 block w-60 max-w-[calc(100vw-6rem)] overflow-hidden rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        className="relative grid h-32 place-items-center bg-[#dfe9d8] dark:bg-[#2a3a2e]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.55) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,.55) 2px, transparent 2px), linear-gradient(35deg, transparent 46%, rgba(255,214,102,.9) 46%, rgba(255,214,102,.9) 54%, transparent 54%)",
          backgroundSize: "34px 34px, 34px 34px, 100% 100%",
        }}
        aria-hidden
      >
        <span className="grid size-11 place-items-center rounded-full bg-[#ff3b30] text-white shadow-lg ring-4 ring-white/80">
          <MapPin className="size-6" />
        </span>
      </div>
      <div className={cn("flex items-center gap-2 px-3 py-2", mine ? "bg-black/10" : "bg-foreground/[0.04]")}>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-5">Location</span>
          <span className={cn("block truncate text-xs tabular-nums", mine ? "text-white/80" : "text-muted-foreground")}>
            {coords}
          </span>
        </span>
        <Navigation className="size-4 shrink-0 opacity-80" aria-hidden />
      </div>
    </a>
  );
}
