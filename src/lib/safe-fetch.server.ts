import "server-only";
import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isBlockedAddress } from "@/lib/link-preview";

/**
 * Fetches a public web page or image for link previews without letting
 * anyone use our server to reach private networks (SSRF): every connection
 * — including after redirects — goes through a DNS lookup that refuses
 * private, local and special-purpose addresses, so DNS tricks can't sneak in
 * between checking and connecting. Small size and time limits.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }), "", 4);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

export interface SafeResponse {
  status: number;
  contentType: string;
  body: Buffer;
  url: string;
}

export async function safeFetch(
  rawUrl: string,
  { maxBytes, accept, timeoutMs = 6000, redirects = 4 }: { maxBytes: number; accept: string; timeoutMs?: number; redirects?: number },
): Promise<SafeResponse> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= redirects; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only web links");
    if (url.username || url.password) throw new Error("No credentials in links");
    if (url.port && !["80", "443", "8080", "8443"].includes(url.port)) throw new Error("Unusual port");
    // IP-address links connect without a DNS lookup, so check them here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isBlockedAddress(host)) throw new Error("Blocked address");
    const res = await request(url, accept, maxBytes, timeoutMs);
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = new URL(res.location, url);
      continue;
    }
    return { status: res.status, contentType: res.contentType, body: res.body, url: url.toString() };
  }
  throw new Error("Too many redirects");
}

function request(url: URL, accept: string, maxBytes: number, timeoutMs: number) {
  return new Promise<{ status: number; contentType: string; body: Buffer; location?: string }>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: {
          accept,
          "accept-language": "en",
          // Many sites only return preview tags to known link-preview bots.
          "user-agent": "Mozilla/5.0 (compatible; LinkPreviewBot/1.0; +https://github.com/)",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : undefined;
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, contentType, body: Buffer.alloc(0), location });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            // Enough for preview tags; stop downloading.
            chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (size - maxBytes))));
            res.destroy();
            resolve({ status, contentType, body: Buffer.concat(chunks) });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
    req.end();
  });
}
