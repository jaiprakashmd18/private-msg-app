import { redirect } from "next/navigation";
import { getAccessState } from "@/lib/access";

export default async function Home() {
  const state = await getAccessState();
  if (state.status === "signed_out") redirect("/login");
  redirect(state.status === "ok" && state.access.is_active ? "/chat" : "/unauthorized");
}
