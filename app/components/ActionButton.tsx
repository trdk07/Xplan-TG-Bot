import type { ComponentType, SVGProps } from "react";

type ActionButtonProps = {
  children: React.ReactNode;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  danger?: boolean;
  secondary?: boolean;
  disabled?: boolean;
};

export function ActionButton({
  children,
  icon: Icon,
  danger,
  secondary,
  disabled,
}: ActionButtonProps) {
  return (
    <button
      className={`button${secondary ? " secondary" : ""}${danger ? " danger" : ""}`}
      disabled={disabled}
      type="submit"
    >
      <Icon width={16} height={16} aria-hidden="true" />
      {children}
    </button>
  );
}
