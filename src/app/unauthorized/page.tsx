import { ShieldOff } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getAccess } from "@/lib/access";

export const metadata: Metadata = { title: "Access not available" };

export default async function UnauthorizedPage() {
  const access = await getAccess();
  if (!access) redirect("/login");
  if (access.is_active) redirect("/chat");

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-destructive/15 text-destructive">
          <ShieldOff className="size-6" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold">Access not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The Google account <span className="font-medium text-foreground">{access.email}</span> is not currently
          approved to use this app. If you think this is a mistake, contact the administrator.
        </p>
        <SignOutButton variant="outline" className="mt-6 w-full" />
      </div>
    </main>
  );
}
