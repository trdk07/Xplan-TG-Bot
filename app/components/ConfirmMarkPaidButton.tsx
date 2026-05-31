"use client";

import { BadgeCheck } from "lucide-react";

type Props = {
  label: string;
  previewDate: string;
  confirmMessage: string;
};

export function ConfirmMarkPaidButton({ label, previewDate, confirmMessage }: Props) {
  return (
    <button
      className="button"
      type="submit"
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      <BadgeCheck width={16} height={16} aria-hidden="true" />
      <span className="confirm-btn-content">
        <span>{label}</span>
        <span className="confirm-btn-preview">到期日將變為：{previewDate}</span>
      </span>
    </button>
  );
}
