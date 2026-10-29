import { ShieldOff } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getAccessState } from "@/lib/access";

export const metadata: Metadata = { title: "Access not available" };

export default async function UnauthorizedPage() {
  const state = await getAccessState();
  if (state.status === "signed_out") redirect("/login");
  if (state.status === "ok" && state.access.is_active) redirect("/chat");
  const email = state.status === "ok" ? state.access.email : state.email;

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-destructive/15 text-destructive">
          <ShieldOff className="size-6" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold">Access not available</h1>
        {state.status === "ok" ? (
          <p className="mt-2 text-sm text-muted-foreground">
            The Google account <span className="font-medium text-foreground">{email}</span> is not currently
            approved to use this app. If you think this is a mistake, contact the administrator.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            You&apos;re signed in{email ? (
              <>
                {" "}as <span className="font-medium text-foreground">{email}</span>
              </>
            ) : null}
            , but this account isn&apos;t set up in the app yet. If you are the administrator, make sure the
            database setup has been run and your email is on the allowlist, then sign out and sign in again.
          </p>
        )}
        <SignOutButton variant="outline" className="mt-6 w-full" />
      </div>
    </main>
  );
}
