"use client";

import { useEffect, useState } from "react";
import { Image as ImageIcon, X } from "lucide-react";

export function proofUrl(fileId: string) {
  return `/api/admin/payment-proof?fileId=${encodeURIComponent(fileId)}`;
}

/**
 * Payment screenshot viewer. Opens in an in-page overlay instead of a new tab:
 * in-app browsers (Telegram, LINE) often cannot open new tabs or downloads.
 */
function useProofOverlay(fileId: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const overlay = open ? (
    <div
      className="proof-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="付款截圖"
      onClick={() => setOpen(false)}
    >
      <button type="button" className="proof-overlay-close" aria-label="關閉">
        <X width={18} height={18} aria-hidden="true" />
        關閉
      </button>
      <img src={proofUrl(fileId)} alt="付款截圖" />
    </div>
  ) : null;
  return { show: () => setOpen(true), overlay };
}

/** Inline thumbnail; tapping enlarges it on the same page. */
export function ProofThumbnail({ fileId }: { fileId: string }) {
  const { show, overlay } = useProofOverlay(fileId);
  return (
    <>
      <button type="button" className="proof-thumb" onClick={show}>
        <img src={proofUrl(fileId)} alt="付款截圖（點擊放大）" loading="lazy" />
        <span className="proof-thumb-hint">點擊放大</span>
      </button>
      {overlay}
    </>
  );
}

/** "看截圖" button that opens the same overlay. */
export function ProofButton({
  fileId,
  className = "button secondary small",
}: {
  fileId: string;
  className?: string;
}) {
  const { show, overlay } = useProofOverlay(fileId);
  return (
    <>
      <button type="button" className={className} onClick={show}>
        <ImageIcon width={13} height={13} aria-hidden="true" />
        看截圖
      </button>
      {overlay}
    </>
  );
}
