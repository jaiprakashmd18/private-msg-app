/**
 * Love taps, moods and daily questions: the words and emoji used in the chat
 * and in notifications.
 */

export type TapKind = "heart" | "miss_you" | "hug" | "kiss";

export const TAPS: { kind: TapKind; emoji: string; label: string; notification: string; burst: string[] }[] = [
  { kind: "heart", emoji: "❤️", label: "Thinking of you", notification: "is thinking of you ❤️", burst: ["❤️", "💖"] },
  { kind: "miss_you", emoji: "🥺", label: "I miss you", notification: "misses you 🥺", burst: ["🥺", "💞", "💗"] },
  { kind: "hug", emoji: "🤗", label: "Sending a hug", notification: "is sending you a hug 🤗", burst: ["🤗", "💛"] },
  { kind: "kiss", emoji: "😘", label: "Sending a kiss", notification: "sent you a kiss 😘", burst: ["😘", "💋", "💕"] },
];

export const tapFor = (kind: string | undefined) => TAPS.find((t) => t.kind === kind) ?? TAPS[0]!;

/** "Alex misses you 🥺" / "You sent “I miss you” 🥺". */
export function describeTap(kind: string | undefined, actor: string): string {
  const tap = tapFor(kind);
  if (actor === "You") return tap.kind === "heart" ? "You sent a ❤️" : `You sent “${tap.label}” ${tap.emoji}`;
  return `${actor} ${tap.notification}`;
}

export const MOODS: { emoji: string; label: string }[] = [
  { emoji: "😊", label: "Happy" },
  { emoji: "🥰", label: "Loved" },
  { emoji: "🥳", label: "Excited" },
  { emoji: "😌", label: "Calm" },
  { emoji: "😴", label: "Tired" },
  { emoji: "🥺", label: "Missing you" },
  { emoji: "😔", label: "Down" },
  { emoji: "😤", label: "Stressed" },
  { emoji: "🤒", label: "Unwell" },
  { emoji: "🤔", label: "Thoughtful" },
  { emoji: "😋", label: "Hungry" },
  { emoji: "💪", label: "Motivated" },
];

export const moodLabel = (emoji: string) => MOODS.find((m) => m.emoji === emoji)?.label ?? "";

/** "Sam is feeling 😴 Tired — “Long day”". */
export function describeMood(mood: string, note: string | null | undefined, actor: string): string {
  const label = moodLabel(mood);
  return `${actor} ${actor === "You" ? "are" : "is"} feeling ${mood}${label ? ` ${label.toLowerCase()}` : ""}${note ? ` — “${note}”` : ""}`;
}

export const DAILY_QUESTIONS = [
  "What's your favourite memory of us?",
  "What made you smile today?",
  "Where would you love to travel together?",
  "What's one small thing I do that you love?",
  "What was your first impression of me?",
  "What song reminds you of us?",
  "What's a dream you haven't told me about?",
  "What's your idea of a perfect lazy Sunday together?",
  "What's something you're proud of this week?",
  "Which meal would you want us to cook together?",
  "What's a movie we should watch next?",
  "What's one thing you want us to try this year?",
  "When did you know you liked me?",
  "What's your favourite photo of us, and why?",
  "What's something that always cheers you up?",
  "If we had a free day tomorrow, what would we do?",
  "What's a habit of mine that makes you laugh?",
  "What's one thing you'd like more of from me?",
  "What's the best gift you've ever received?",
  "What does a perfect date look like to you?",
  "What are you looking forward to this month?",
  "What's a place that feels like home to you?",
  "What's something new you'd like to learn together?",
  "Which of our trips or outings was the most fun?",
  "What's a compliment you'd love to hear more often?",
  "What's your comfort food when you're sad?",
  "What would our dream home have?",
  "What's one thing you've never told me but want to?",
  "What makes you feel most loved?",
  "What's a silly fear you have?",
  "What's the funniest moment we've had together?",
  "What's a tradition you'd like us to start?",
  "What would you name our pet?",
  "What's one word that describes us?",
  "What's something you're grateful for today?",
  "Which season do you love most, and why?",
  "What's a goal we could work on together?",
  "What's your favourite way to spend an evening with me?",
  "Who's your favourite fictional couple?",
  "What would you write in a letter to us in 10 years?",
  "What's the best advice you've ever got?",
  "What's your hidden talent?",
  "What do you think I'm thinking about right now?",
  "What's a little thing that made today better?",
  "Where should our next date be?",
  "What's a childhood memory you love?",
  "What's one thing you'd change about today?",
  "What do you admire most about me?",
  "What's on your bucket list?",
  "If we could live anywhere for a year, where?",
  "What's a song you'd dedicate to me?",
  "What's the sweetest thing someone has done for you?",
  "What's something that always makes you think of me?",
  "What's your favourite thing about our chats?",
  "What would be your perfect anniversary surprise?",
  "What's one thing we should do more often?",
  "What's your love language?",
  "What's the most beautiful place you've seen?",
  "What made you laugh the hardest recently?",
  "What do you want to tell me today, no matter what?",
];

/** Same question for both of you each day (by your local date). */
export function questionIndexFor(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const dayNumber = Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
  return ((dayNumber % DAILY_QUESTIONS.length) + DAILY_QUESTIONS.length) % DAILY_QUESTIONS.length;
}

export const questionText = (index: number) => DAILY_QUESTIONS[index % DAILY_QUESTIONS.length]!;

/** "Sat 2 Nov, 7:00 pm" in the viewer's own time zone. */
export function formatPlanTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Short form for small spaces: "today 7 pm", "tmrw 7:30 pm", "Sat 7 pm". */
export function formatPlanTimeShort(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: d.getMinutes() ? "2-digit" : undefined });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return `today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tmrw ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** Chat notes for plans and the journal. */
export function describePlanAdded(actor: string, title: string, startsAt: string, place?: string | null): string {
  return `📅 ${actor} planned “${title}” · ${formatPlanTime(startsAt)}${place ? ` · ${place}` : ""}`;
}

export function describePlanReminder(title: string, startsAt: string, now = Date.now()): string {
  const minutes = Math.round((new Date(startsAt).getTime() - now) / 60_000);
  const when =
    minutes <= 1 ? "now" : minutes < 60 ? `in ${minutes} minutes` : minutes < 24 * 60 ? `in ${Math.round(minutes / 60)} h` : `on ${formatPlanTime(startsAt)}`;
  return `⏰ “${title}” ${when}`;
}

export function describeJournal(actor: string): string {
  return actor === "You" ? "You wrote in your journal 📔" : `${actor} wrote in your journal 📔`;
}
