import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppLockGate } from "@/components/app-lock/app-lock-gate";
import { AppProvider } from "@/components/app-provider";
import { getSettings, requireActiveUser } from "@/lib/access";
import { LOCK_COOKIE } from "@/lib/app-lock";

// Every page in this group requires an ACTIVE allowlisted user, checked
// against the database on each request.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const access = await requireActiveUser();
  // A password set by the administrator is temporary.
  if (access.must_change_password) redirect("/set-password");
  const settings = await getSettings();
  // Set on devices where someone turned on app lock: start locked, so the
  // page never shows messages before the lock screen appears.
  const lockCookie = (await cookies()).get(LOCK_COOKIE)?.value === "1";
  return (
    <AppProvider access={access} settings={settings}>
      <AppLockGate initiallyLocked={lockCookie}>{children}</AppLockGate>
    </AppProvider>
  );
}
