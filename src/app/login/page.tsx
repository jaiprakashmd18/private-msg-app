import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { APP_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main id="main" className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary">
            <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
              <path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.7 1.4 5.1 3.7 6.7L5 22l4.6-2.4c.8.2 1.6.2 2.4.2 5.5 0 10-3.9 10-8.7S17.5 3 12 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Private messaging for invited members.</p>
        </div>
        <LoginForm errorKey={typeof error === "string" ? error : undefined} />
        <p className="mt-8 text-center text-xs text-muted-foreground">
          Access is by invitation only. Read the{" "}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
            privacy notice
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
