"use client";

import type { PendingFile } from "@/types/app";

const MAX_IMAGE_EDGE = 2048;
const THUMB_EDGE = 480;
const RECOMPRESS_ABOVE_BYTES = 1.5 * 1024 * 1024;
const DECODABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function isImage(mime: string) {
  return mime.startsWith("image/");
}

export function isVideo(mime: string) {
  return mime.startsWith("video/");
}

/**
 * A video to send: a JPEG thumbnail of an early frame, its size and length.
 * If the browser can't decode it (e.g. some iPhone HEVC videos in Chrome),
 * it is sent without a thumbnail.
 */
export async function prepareVideo(file: File): Promise<PendingFile> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Can't read this video"));
      setTimeout(() => reject(new Error("Timed out")), 8000);
    });
    video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 1500);
    });
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return { file };
    const scale = Math.min(1, 480 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const thumb = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.75));
    return {
      file,
      thumb: thumb ?? undefined,
      width: w,
      height: h,
      durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
      previewUrl: thumb ? URL.createObjectURL(thumb) : undefined,
    };
  } catch {
    return { file };
  } finally {
    URL.revokeObjectURL(url);
  }
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

/** Square, centre-cropped JPEG for profile and group photos. */
export async function prepareAvatar(file: File, size = 320): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    throw new Error("Please choose a JPG, PNG or WebP photo.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), "image/jpeg", 0.85),
    );
  } finally {
    bitmap.close();
  }
}

/** A chat wallpaper: at most 1600 px on the long side, JPEG (well under 2 MB). */
export async function prepareWallpaper(file: File, maxSide = 1600): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    throw new Error("Please choose a JPG, PNG or WebP photo.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding failed"))), "image/jpeg", 0.8),
    );
  } finally {
    bitmap.close();
  }
}
