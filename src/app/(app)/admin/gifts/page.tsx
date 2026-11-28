import { GiftCode } from "@/components/plus/gift-code";

export default function GiftsPage() {
  return (
    <section className="grid max-w-lg gap-4 rounded-2xl border bg-card p-5">
      <h1 className="text-2xl font-semibold">Plus gift codes</h1>
      <p className="text-sm text-muted-foreground">Share a code with the intended member. Each code can be redeemed once.</p>
      <GiftCode admin />
    </section>
  );
}
