"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An unexpected error occurred. Your messages are safe — try again.
        </p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
