import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MemoriesView } from "@/components/chat/couple/memories-view";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Memories" };

export default async function MemoriesPage({ params }: PageProps<"/chat/[conversationId]/memories">) {
  const { conversationId } = await params;
  if (!uuidSchema.safeParse(conversationId).success) notFound();
  return <MemoriesView key={conversationId} conversationId={conversationId} />;
}
