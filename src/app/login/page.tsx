import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { APP_NAME } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, detail } = await searchParams;
  return (
    <main
      id="main"
      className="grid min-h-dvh bg-grouped lg:grid-cols-[minmax(0,1fr)_minmax(26rem,0.85fr)]"
    >
      <div className="login-brand flex flex-col justify-between gap-8 px-6 pb-8 pt-[max(2rem,env(safe-area-inset-top))] text-[#fff7f2] sm:px-12 lg:p-14">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <Image src="/icon.svg" width={48} height={48} alt="" className="rounded-xl ring-1 ring-[#f6a8bb]/30" unoptimized />
          {APP_NAME}
        </div>
        <p className="max-w-[14ch] text-4xl font-semibold leading-[1.06] tracking-[-0.055em] sm:text-5xl lg:text-7xl">
          Private messaging for invited members.
        </p>
        <Link href="/privacy" className="hidden self-start text-sm text-[#f6d4e1] underline underline-offset-4 lg:block">
          Privacy notice
        </Link>
      </div>

      <section className="grid items-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 sm:px-10 lg:pt-[max(2rem,env(safe-area-inset-top))]">
        <div className="mx-auto w-full max-w-md">
          <h1 className="mb-5 text-3xl font-semibold tracking-tight">Sign in</h1>
          <LoginForm errorKey={typeof error === "string" ? error : undefined} errorDetail={typeof detail === "string" ? detail : undefined} />
          <Link href="/privacy" className="mt-6 inline-block text-sm text-muted-foreground underline underline-offset-4 lg:hidden">
            Privacy notice
          </Link>
        </div>
      </section>
    </main>
  );
}
