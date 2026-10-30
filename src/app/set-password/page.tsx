import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireActiveUser } from "@/lib/access";

export const metadata: Metadata = { title: "Choose a password" };

export default async function SetPasswordPage() {
  const access = await requireActiveUser();
  if (!access.must_change_password) redirect("/chat");
  return (
    <main
      id="main"
      className="grid min-h-dvh place-items-center px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]"
    >
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Choose your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You signed in with a temporary password from the administrator. Pick your own so only you know it.
        </p>
        <SetPasswordForm email={access.email} />
        <div className="mt-4 text-center">
          <SignOutButton variant="ghost" size="sm" />
        </div>
      </div>
    </main>
  );
}
