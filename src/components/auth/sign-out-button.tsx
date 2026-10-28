"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { signOut } from "@/lib/auth-client";

export function SignOutButton({ everywhere = false, children, ...props }: ButtonProps & { everywhere?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      {...props}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signOut(everywhere);
      }}
    >
      {busy ? <Spinner /> : <LogOut aria-hidden />}
      {children ?? "Sign out"}
    </Button>
  );
}
