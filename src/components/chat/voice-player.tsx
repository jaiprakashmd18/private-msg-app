"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/media";
import { cn } from "@/lib/utils";

/** Compact voice-note player: play/pause, seek bar, time. */
export function VoicePlayer({
  src,
  durationMs,
  mine,
  label = "Voice message",
}: {
  src: string | null;
  durationMs: number | null;
  mine: boolean;
  label?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const total = durationMs ?? mediaDuration ?? 0;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onTime = () => setPosition(el.currentTime * 1000);
    const onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    const onMeta = () => Number.isFinite(el.duration) && setMediaDuration(el.duration * 1000);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("pause", () => setPlaying(false));
    el.addEventListener("play", () => setPlaying(true));
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("error", () => setFailed(true));
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, [src]);

  function toggle() {
    const el = audio.current;
    if (!el || !src) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  }

  return (
    <div className="flex w-60 max-w-full items-center gap-2.5 py-0.5">
      {src && <audio ref={audio} src={src} preload="metadata" />}
      <button
        type="button"
        onClick={toggle}
        disabled={!src || failed}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50",
          mine ? "bg-white/20 hover:bg-white/30" : "bg-foreground/10 hover:bg-foreground/15",
        )}
      >
        {playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={Math.max(total, 1)}
          value={Math.min(position, total)}
          step={100}
          disabled={!src || failed}
          aria-label="Seek"
          onChange={(e) => {
            const el = audio.current;
            if (el) el.currentTime = Number(e.target.value) / 1000;
            setPosition(Number(e.target.value));
          }}
          className={cn("h-1.5 w-full cursor-pointer", mine ? "accent-white" : "accent-primary")}
        />
        <div className="mt-1 text-[11px] opacity-75">
          {failed ? (
            <a href={src ?? undefined} download className="underline">
              Can&apos;t play here — download
            </a>
          ) : (
            formatDuration(playing || position > 0 ? position : total)
          )}
        </div>
      </div>
    </div>
  );
}
