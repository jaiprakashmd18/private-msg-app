import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
        <Button asChild className="mt-6">
          <Link href="/chat">Back to messages</Link>
        </Button>
      </div>
    </main>
  );
}
