"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";

/**
 * Short-lived signed URLs for files in private buckets. Storage only issues
 * them if the RLS policies allow the signed-in user. Reused for 20 minutes
 * (they are valid for 30).
 */
const cache = new Map<string, string>();

function remember(key: string, url: string) {
  cache.set(key, url);
  setTimeout(() => cache.delete(key), 20 * 60_000);
}

export function useSignedUrl(
  bucket: string,
  path: string | null | undefined,
  download?: string,
): { url: string | null; failed: boolean } {
  const { supabase } = useApp();
  const key = path ? `${bucket}|${path}|${download ?? ""}` : null;
  const [fetched, setFetched] = useState<{ key: string; url: string | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!path || !key || cache.has(key)) return;
    let cancelled = false;
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 30, download ? { download } : undefined)
      .then(({ data, error }) => {
        if (error || !data) throw error ?? new Error("No URL");
        remember(key, data.signedUrl);
        if (!cancelled) setFetched({ key, url: data.signedUrl, failed: false });
      })
      .catch(() => !cancelled && setFetched({ key, url: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [supabase, bucket, path, download, key]);

  const cached = key ? cache.get(key) : undefined;
  if (cached) return { url: cached, failed: false };
  if (fetched && fetched.key === key) return fetched;
  return { url: null, failed: false };
}
