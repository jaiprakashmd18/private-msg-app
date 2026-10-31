/** A GIF as the app uses it (from GIPHY). */
export interface Gif {
  id: string;
  title: string;
  url: string;
  width: number;
  height: number;
}

/** Same rule the database applies in send_sticker. */
export const GIPHY_URL = /^https:\/\/(media[0-9]?|i)\.giphy\.com\/[A-Za-z0-9/_.%-]+(\?[A-Za-z0-9=&._%-]*)?$/;

interface GiphyImage {
  url?: string;
  width?: string;
  height?: string;
}

/** Turns a GIPHY API response into safe, compact GIFs (drops anything unexpected). */
export function parseGiphyResponse(body: unknown): Gif[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const gifs: Gif[] = [];
  for (const item of data as { id?: unknown; title?: unknown; images?: Record<string, GiphyImage> }[]) {
    const image = item.images?.fixed_width ?? item.images?.downsized;
    const url = image?.url;
    if (typeof url !== "string" || !GIPHY_URL.test(url)) continue;
    const width = Number(image?.width);
    const height = Number(image?.height);
    gifs.push({
      id: typeof item.id === "string" ? item.id.slice(0, 64) : "",
      title: typeof item.title === "string" ? item.title.slice(0, 140) : "",
      url,
      width: Number.isFinite(width) && width > 0 ? Math.round(width) : 200,
      height: Number.isFinite(height) && height > 0 ? Math.round(height) : 200,
    });
  }
  return gifs;
}
