"use client";

import type { PendingFile } from "@/types/app";

const MAX_IMAGE_EDGE = 2048;
const THUMB_EDGE = 480;
const RECOMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;
const DECODABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function isImage(mime: string) {
  return mime.startsWith("image/");
}

export function isAudio(mime: string) {
  return mime.startsWith("audio/");
}

function fit(w: number, h: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

async function encode(bitmap: ImageBitmap, edge: number, quality: number): Promise<Blob> {
  const { width, height } = fit(bitmap.width, bitmap.height, edge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  // White background so transparent PNGs don't turn black as JPEG.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), "image/jpeg", quality),
  );
}

/**
 * Prepares a photo for sending: reads its size, makes a small thumbnail for
 * the chat, and shrinks very large photos (keeps GIFs as they are so they
 * still animate). Files the browser can't decode (e.g. HEIC) are sent as-is.
 */
export async function prepareImage(file: File): Promise<PendingFile> {
  if (!DECODABLE.has(file.type) || typeof createImageBitmap !== "function") {
    return { file };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file };
  }
  try {
    const result: PendingFile = { file, width: bitmap.width, height: bitmap.height };
    const tooBig = Math.max(bitmap.width, bitmap.height) > MAX_IMAGE_EDGE || file.size > RECOMPRESS_ABOVE_BYTES;
    if (file.type !== "image/gif" && tooBig) {
      const blob = await encode(bitmap, MAX_IMAGE_EDGE, 0.85);
      if (blob.size < file.size) {
        const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
        result.file = new File([blob], name, { type: "image/jpeg" });
        const size = fit(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);
        result.width = size.width;
        result.height = size.height;
      }
    }
    result.thumb = await encode(bitmap, THUMB_EDGE, 0.75);
    result.previewUrl = URL.createObjectURL(result.thumb);
    return result;
  } finally {
    bitmap.close();
  }
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Best recording format the browser supports (MP4/AAC plays everywhere, incl. iPhone). */
export function pickAudioMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}
