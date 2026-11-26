import { notFound } from "next/navigation";
import { OurSpace } from "@/components/chat/couple/our-space";
import { uuidSchema } from "@/lib/validation";

export default async function SpacePage({ params }: PageProps<"/chat/[conversationId]/space">) {
  const { conversationId } = await params;
  if (!uuidSchema.safeParse(conversationId).success) notFound();
  return <OurSpace key={conversationId} conversationId={conversationId} />;
}
