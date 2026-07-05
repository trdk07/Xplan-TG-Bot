"use client";

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

type ActionButtonProps = {
  children: ReactNode;
  icon: ReactElement;
  danger?: boolean;
  secondary?: boolean;
  small?: boolean;
  disabled?: boolean;
};

export function ActionButton({
  children,
  icon,
  danger,
  secondary,
  small,
  disabled,
}: ActionButtonProps) {
  const { pending } = useFormStatus();
  const size = small ? 13 : 16;
  const sizedIcon = isValidElement<{ width?: number; height?: number }>(icon)
    ? cloneElement(icon, { width: size, height: size })
    : icon;

  return (
    <button
      className={`button${secondary ? " secondary" : ""}${danger ? " danger" : ""}${small ? " small" : ""}`}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? (
        <Loader2 className="spin" width={size} height={size} aria-hidden="true" />
      ) : (
        sizedIcon
      )}
      {pending ? "處理中…" : children}
    </button>
  );
}
