"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_VOICE_NOTE_MS } from "@/lib/constants";
import { pickAudioMime } from "@/lib/media";
import type { PendingFile } from "@/types/app";

export type RecorderState = "idle" | "recording";

/** Records a voice note with the microphone (MediaRecorder). */
export function useVoiceRecorder(onLimit?: () => void) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const finish = useRef<((file: PendingFile | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    setState("idle");
    setElapsed(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    const mime = pickAudioMime();
    if (mime === null || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Voice messages aren't supported in this browser.");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new Error("Microphone access was blocked. Allow it in your browser or phone settings.");
    }
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
    rec.onstop = () => {
      const type = (rec.mimeType || mime || "audio/webm").split(";")[0]!;
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      const durationMs = Date.now() - startedAt.current;
      const blob = new Blob(chunks.current, { type });
      const done = finish.current;
      finish.current = null;
      cleanup();
      done?.(blob.size > 0 ? { file: new File([blob], `Voice message.${ext}`, { type }), durationMs } : null);
    };
    recorder.current = rec;
    startedAt.current = Date.now();
    rec.start(250);
    setState("recording");
    timer.current = setInterval(() => {
      const ms = Date.now() - startedAt.current;
      setElapsed(ms);
      if (ms >= MAX_VOICE_NOTE_MS) {
        onLimit?.();
      }
    }, 200);
  }, [cleanup, onLimit]);

  /** Stops and returns the recording. */
  const stop = useCallback(
    () =>
      new Promise<PendingFile | null>((resolve) => {
        const rec = recorder.current;
        if (!rec || rec.state === "inactive") return resolve(null);
        finish.current = resolve;
        rec.stop();
      }),
    [],
  );

  const cancel = useCallback(() => {
    finish.current = null;
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = () => cleanup();
      rec.stop();
    } else cleanup();
  }, [cleanup]);

  return { state, elapsed, start, stop, cancel };
}
