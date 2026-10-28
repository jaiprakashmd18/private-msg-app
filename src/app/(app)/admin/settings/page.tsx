import type { Metadata } from "next";
import { SettingsForm } from "@/components/admin/settings-form";
import { getSettings } from "@/lib/access";

export const metadata: Metadata = { title: "Privacy & retention" };

export default async function AdminSettingsPage() {
  const settings = await getSettings();
  if (!settings) return <p className="text-sm text-destructive">Could not load settings.</p>;
  return <SettingsForm settings={settings} />;
}
