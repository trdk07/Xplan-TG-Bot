"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyEmailListButton({ emails }: { emails: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="button secondary small"
      disabled={!emails}
      onClick={async () => {
        await navigator.clipboard.writeText(emails);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <Check width={13} height={13} aria-hidden="true" />
      ) : (
        <Copy width={13} height={13} aria-hidden="true" />
      )}
      {copied ? "已複製" : "複製清單"}
    </button>
  );
}
