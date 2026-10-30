"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePendingRequests } from "@/hooks/use-pending-requests";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Members & access" },
  { href: "/admin/requests", label: "Access requests" },
  { href: "/admin/conversations", label: "Conversations" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/settings", label: "Privacy & retention" },
];

export function AdminNav() {
  const pathname = usePathname();
  const pending = usePendingRequests(pathname);
  return (
    <nav aria-label="Admin sections" className="mx-auto max-w-6xl overflow-x-auto px-2">
      <ul className="flex gap-1 py-2">
        {LINKS.map((l) => {
          const active = l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-accent",
                  active ? "bg-accent font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {l.label}
                {l.href === "/admin/requests" && pending > 0 && (
                  <span className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                    <span className="sr-only">pending: </span>
                    {pending}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
