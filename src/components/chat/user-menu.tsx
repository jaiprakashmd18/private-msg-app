"use client";

import { LogOut, MoreVertical, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";
import { displayNameOf } from "@/lib/format";

export function UserMenu() {
  const { access } = useApp();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Account menu">
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block font-medium text-foreground">{displayNameOf(access.display_name, access.phone_e164)}</span>
          <span className="block">{access.phone_e164}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <UserRound /> Profile &amp; settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/privacy">
            <ShieldCheck /> Privacy notice
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void signOut(false)}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
