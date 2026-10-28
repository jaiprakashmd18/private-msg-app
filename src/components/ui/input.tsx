import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-lg border border-input bg-background/40 px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
        className,
      )}
      {...props}
    />
  );
}
