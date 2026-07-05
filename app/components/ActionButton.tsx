"use client";

import type { ComponentType, SVGProps } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

type ActionButtonProps = {
  children: React.ReactNode;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  danger?: boolean;
  secondary?: boolean;
  small?: boolean;
  disabled?: boolean;
};

export function ActionButton({
  children,
  icon: Icon,
  danger,
  secondary,
  small,
  disabled,
}: ActionButtonProps) {
  const { pending } = useFormStatus();
  const size = small ? 13 : 16;

  return (
    <button
      className={`button${secondary ? " secondary" : ""}${danger ? " danger" : ""}${small ? " small" : ""}`}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? (
        <Loader2 className="spin" width={size} height={size} aria-hidden="true" />
      ) : (
        <Icon width={size} height={size} aria-hidden="true" />
      )}
      {pending ? "處理中…" : children}
    </button>
  );
}
