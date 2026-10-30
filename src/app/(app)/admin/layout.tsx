import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/lib/access";

// Server-side gate: only ACTIVE administrators (per the database) get past
// this layout. Every admin RPC re-checks this independently.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pb-0 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Link
            href="/chat"
            className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden /> Messages
          </Link>
          <span className="text-muted-foreground" aria-hidden>
            /
          </span>
          <span className="font-semibold">Admin</span>
        </div>
        <AdminNav />
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6">
        {children}
      </main>
    </div>
  );
}
