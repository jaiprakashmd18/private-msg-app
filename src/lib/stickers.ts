/**
 * The built-in sticker pack: drawn from emoji and colours (no image files),
 * so stickers look sharp everywhere and need no hosting. A sticker message
 * stores only the id; `label` doubles as its text in previews and
 * notifications.
 */
export interface StickerDef {
  id: string;
  emoji: string;
  label: string;
  /** Gradient colours (CSS). */
  from: string;
  to: string;
}

export const STICKERS: StickerDef[] = [
  { id: "love-you", emoji: "💖", label: "Love you", from: "#ff5e8a", to: "#ff9a8b" },
  { id: "miss-you", emoji: "🥺", label: "Miss you", from: "#8e6cff", to: "#c07bff" },
  { id: "hug", emoji: "🤗", label: "Big hug", from: "#ff9f43", to: "#ffd36e" },
  { id: "kiss", emoji: "😘", label: "Kiss!", from: "#ff4d6d", to: "#ff8fa3" },
  { id: "good-morning", emoji: "☀️", label: "Good morning", from: "#ffb703", to: "#ffd166" },
  { id: "good-night", emoji: "🌙", label: "Good night", from: "#3a3f8f", to: "#6c63ff" },
  { id: "sweet-dreams", emoji: "💤", label: "Sweet dreams", from: "#4d5bce", to: "#9b8cff" },
  { id: "thinking-of-you", emoji: "💭", label: "Thinking of you", from: "#22a6b3", to: "#7ed6df" },
  { id: "proud", emoji: "🌟", label: "So proud", from: "#f9a825", to: "#ffe082" },
  { id: "sorry", emoji: "🥹", label: "Sorry", from: "#6a89cc", to: "#a4b8f0" },
  { id: "thank-you", emoji: "🙏", label: "Thank you", from: "#2ecc71", to: "#a3e4a1" },
  { id: "hungry", emoji: "🍕", label: "Hungry?", from: "#e67e22", to: "#f8c471" },
  { id: "coffee", emoji: "☕", label: "Coffee?", from: "#8d5a3b", to: "#c79a6d" },
  { id: "on-my-way", emoji: "🚗", label: "On my way", from: "#0984e3", to: "#74b9ff" },
  { id: "call-me", emoji: "📞", label: "Call me", from: "#00b894", to: "#55efc4" },
  { id: "haha", emoji: "😂", label: "Haha", from: "#fdcb6e", to: "#ffeaa7" },
  { id: "cutie", emoji: "🥰", label: "Cutie", from: "#fd79a8", to: "#fab1c4" },
  { id: "yes", emoji: "👍", label: "Yes!", from: "#00a8ff", to: "#7fd3ff" },
  { id: "no-way", emoji: "🙅", label: "No way", from: "#e84118", to: "#ff7f6e" },
  { id: "yay", emoji: "🎉", label: "Yay!", from: "#9c88ff", to: "#fbc531" },
];

const byId = new Map(STICKERS.map((s) => [s.id, s]));
export const stickerById = (id: string) => byId.get(id);

/** Text version for previews/notifications, e.g. "💖 Love you". */
export const stickerText = (s: StickerDef) => `${s.emoji} ${s.label}`;

/** True for a short message made only of emoji (1–3), shown large without a bubble. */
export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 32) return false;
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)]
    .map((s) => s.segment)
    .filter((s) => s.trim());
  return segments.length >= 1 && segments.length <= 3 && segments.every((s) => /\p{Extended_Pictographic}/u.test(s));
}
