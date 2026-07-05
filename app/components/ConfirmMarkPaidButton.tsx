"use client";

import { BadgeCheck, Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

type Props = {
  label: string;
  previewDate: string;
  confirmMessage: string;
};

export function ConfirmMarkPaidButton({ label, previewDate, confirmMessage }: Props) {
  const { pending } = useFormStatus();

  return (
    <button
      className="button"
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      {pending ? (
        <Loader2 className="spin" width={16} height={16} aria-hidden="true" />
      ) : (
        <BadgeCheck width={16} height={16} aria-hidden="true" />
      )}
      <span className="confirm-btn-content">
        <span>{pending ? "處理中…" : label}</span>
        {pending ? null : (
          <span className="confirm-btn-preview">到期日將變為：{previewDate}</span>
        )}
      </span>
    </button>
  );
}
