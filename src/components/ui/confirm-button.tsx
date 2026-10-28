"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, type ButtonProps } from "@/components/ui/button";

/** A button that asks for confirmation before running a (destructive) action. */
export function ConfirmButton({
  title,
  description,
  confirmLabel = "Confirm",
  destructive = true,
  onConfirm,
  children,
  ...buttonProps
}: ButtonProps & {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button {...buttonProps}>{children}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            destructive={destructive}
            onClick={() => {
              setOpen(false);
              void onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
