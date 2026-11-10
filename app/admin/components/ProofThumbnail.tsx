/** Inline payment screenshot; tapping opens the full image in a new tab. */
export function proofUrl(fileId: string) {
  return `/api/admin/payment-proof?fileId=${encodeURIComponent(fileId)}`;
}

export function ProofThumbnail({ fileId }: { fileId: string }) {
  const href = proofUrl(fileId);
  return (
    <a className="proof-thumb" href={href} target="_blank" rel="noreferrer">
      <img src={href} alt="付款截圖（點擊放大）" loading="lazy" />
      <span className="proof-thumb-hint">點擊放大</span>
    </a>
  );
}
