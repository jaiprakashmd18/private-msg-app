import { AppProvider } from "@/components/app-provider";
import { getSettings, requireActiveUser } from "@/lib/access";

// Every page in this group requires an ACTIVE allowlisted user, checked
// against the database on each request.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const access = await requireActiveUser();
  const settings = await getSettings();
  return (
    <AppProvider access={access} settings={settings}>
      {children}
    </AppProvider>
  );
}
