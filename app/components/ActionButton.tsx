import type { ComponentType, SVGProps } from "react";

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
  return (
    <button
      className={`button${secondary ? " secondary" : ""}${danger ? " danger" : ""}${small ? " small" : ""}`}
      disabled={disabled}
      type="submit"
    >
      <Icon width={small ? 13 : 16} height={small ? 13 : 16} aria-hidden="true" />
      {children}
    </button>
  );
}
