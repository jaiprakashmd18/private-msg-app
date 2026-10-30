import { redirect } from "next/navigation";
import { AppProvider } from "@/components/app-provider";
import { getSettings, requireActiveUser } from "@/lib/access";

// Every page in this group requires an ACTIVE allowlisted user, checked
// against the database on each request.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const access = await requireActiveUser();
  // A password set by the administrator is temporary.
  if (access.must_change_password) redirect("/set-password");
  const settings = await getSettings();
  return (
    <AppProvider access={access} settings={settings}>
      {children}
    </AppProvider>
  );
}
