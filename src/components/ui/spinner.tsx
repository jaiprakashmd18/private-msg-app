import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 aria-hidden className={cn("size-4 animate-spin", className)} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
