import type { Metadata } from "next";
import { ConversationsManager } from "@/components/admin/conversations-manager";
import { getSettings } from "@/lib/access";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AdminConversation } from "@/types/app";

export const metadata: Metadata = { title: "Conversations" };

export default async function AdminConversationsPage() {
  const supabase = await getSupabaseServerClient();
  const [{ data, error }, settings] = await Promise.all([supabase.rpc("admin_list_conversations"), getSettings()]);
  if (error) return <p className="text-sm text-destructive">Could not load conversations.</p>;
  return (
    <ConversationsManager
      conversations={(data ?? []) as AdminConversation[]}
      canReadMessages={settings?.admin_can_read_messages ?? false}
    />
  );
}
