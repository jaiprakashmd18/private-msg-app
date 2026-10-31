import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JournalView } from "@/components/chat/couple/journal-view";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Our journal" };

export default async function JournalPage({ params }: PageProps<"/chat/[conversationId]/journal">) {
  const { conversationId } = await params;
  if (!uuidSchema.safeParse(conversationId).success) notFound();
  return <JournalView key={conversationId} conversationId={conversationId} />;
}
