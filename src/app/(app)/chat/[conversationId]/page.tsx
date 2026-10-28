import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ConversationView } from "@/components/chat/conversation-view";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: PageProps<"/chat/[conversationId]">) {
  const { conversationId } = await params;
  if (!uuidSchema.safeParse(conversationId).success) notFound();
  return (
    <Suspense>
      <ConversationView key={conversationId} conversationId={conversationId} />
    </Suspense>
  );
}
