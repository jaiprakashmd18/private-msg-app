import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";

export default async function Home() {
  const access = await getAccess();
  if (!access) redirect("/login");
  redirect(access.is_active ? "/chat" : "/unauthorized");
}
