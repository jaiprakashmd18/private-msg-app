/** What a link preview card shows. */
export interface LinkPreview {
  url: string;
  title: string;
  description: string | null;
  siteName: string | null;
  /** Image URL as found on the page (the client loads it through our proxy). */
  image: string | null;
}

/** http(s) links in a message, in order (trailing punctuation trimmed). */
export function findLinks(text: string): { index: number; url: string }[] {
  const out: { index: number; url: string }[] = [];
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  for (const m of text.matchAll(re)) {
    let url = m[0];
    // Trailing punctuation usually belongs to the sentence, not the link.
    while (/[.,:;!?)\]}]$/.test(url) && !(url.endsWith(")") && url.includes("("))) url = url.slice(0, -1);
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") out.push({ index: m.index ?? 0, url });
    } catch {
      // not a URL after all
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
}

function clean(s: string | undefined | null, max: number): string | null {
  if (!s) return null;
  const t = decodeEntities(s).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/** Reads Open Graph / Twitter / <title> data from a page's HTML. */
export function parsePreview(html: string, pageUrl: string): LinkPreview | null {
  const head = html.slice(0, 300_000);
  const meta = new Map<string, string>();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) =>
      tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ??
      tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"))?.[1];
    const key = (attr("property") ?? attr("name"))?.toLowerCase();
    const content = attr("content");
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = clean(meta.get("og:title") ?? meta.get("twitter:title") ?? titleTag, 200);
  if (!title) return null;
  let image: string | null = null;
  const rawImage = meta.get("og:image:secure_url") ?? meta.get("og:image") ?? meta.get("twitter:image");
  if (rawImage) {
    try {
      const resolved = new URL(decodeEntities(rawImage.trim()), pageUrl);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") image = resolved.toString();
    } catch {
      image = null;
    }
  }
  return {
    url: pageUrl,
    title,
    description: clean(meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description"), 300),
    siteName: clean(meta.get("og:site_name"), 80) ?? new URL(pageUrl).hostname.replace(/^www\./, ""),
    image,
  };
}

/** True for addresses our server must never fetch (private, local, special-purpose). */
export function isBlockedAddress(ip: string): boolean {
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  const v6 = ip.toLowerCase();
  if (!v6.includes(":")) return true; // not an IP we understand
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || // link-local
    v6.startsWith("fc") || v6.startsWith("fd") || // unique local
    v6.startsWith("ff") || // multicast
    v6.startsWith("64:ff9b") || // NAT64
    v6.startsWith("2001:db8") ||
    v6.startsWith("::ffff:") // other mapped forms
  );
}
