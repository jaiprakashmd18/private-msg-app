export const CHAT_THEMES = {
  "midnight-rose": "Midnight Rose",
  moonlight: "Moonlight",
  ember: "Ember",
} as const;

export type SharedChatTheme = keyof typeof CHAT_THEMES;

export function parseSongLink(text: string) {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname === "open.spotify.com" && /^\/(?:intl-[a-z]{2}\/)?track\/[a-zA-Z0-9]{22}\/?$/.test(url.pathname)) {
    return { provider: "Spotify", url: url.origin + url.pathname };
  }
  if (url.hostname === "music.apple.com") {
    const track = url.searchParams.get("i");
    const direct = /^\/[a-z]{2}\/song\/(?:[^/]+\/)?\d+\/?$/.test(url.pathname);
    const albumTrack = /^\/[a-z]{2}\/album\/(?:[^/]+\/)?\d+\/?$/.test(url.pathname) && track && /^\d+$/.test(track);
    if (direct || albumTrack) return { provider: "Apple Music", url: url.origin + url.pathname + (albumTrack ? `?i=${track}` : "") };
  }
  return null;
}
