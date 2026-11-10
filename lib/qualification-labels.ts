/** Plain-language labels for exchange/qualification codes shown to the assistant. */
const LABELS: Record<string, string> = {
  admission_disabled: "此交易所的入群自動查核尚未開啟",
  volume_disabled: "交易量自動查詢尚未開啟",
  volume_not_verified: "交易量資料範圍尚未驗收，暫不自動計算",
  full_turnover_unavailable: "此交易所沒有完整的現貨＋合約交易量資料來源",
  credentials_missing: "交易所 API 金鑰未設定",
  upstream_unavailable: "交易所 API 暫時無法連線",
  upstream_rejected: "交易所 API 拒絕請求（金鑰無效或權限不足）",
  deposit_history_incomplete: "歷史入金資料不完整，需人工確認",
  deposit_schema: "交易所回傳的入金資料格式異常",
  invalid_uid: "UID 格式不正確",
  ambiguous_account: "交易所回傳多筆或不明確的帳號資料",
  unexpected_account: "交易所回傳的帳號與查詢的 UID 不符",
  pagination_incomplete: "交易所資料分頁不完整",
  pagination_repeated: "交易所資料分頁重複",
  operation_budget_exceeded: "查詢逾時",
  incomplete_volume_window: "交易量統計期間資料不完整",
  invalid_window: "交易量統計期間不正確",
  volume_total_mismatch: "交易量合計與明細不一致",
};

export function qualificationCodeLabel(code: string | null | undefined) {
  if (!code) return "";
  return LABELS[code] ?? code;
}
