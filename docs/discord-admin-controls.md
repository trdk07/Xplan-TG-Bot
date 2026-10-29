# 後台解除 DC 綁定與立即同步

會員詳細頁新增兩個操作，須使用現有後台管理員登入。支援既有會籍規則與 V2，不改目前 V2 或交易所開關。

- **立即同步 DC 角色**：由 DC Bot 讀取最新 Notion 資格及既有綁定證明，執行原有角色同步並寫回角色結果。不查交易所、不修改付款與交易量證據。帳號未入伺服器、規則確認未完成或資格待覆核時，顯示實際回覆，不宣稱角色已授予。
- **解除 DC 綁定**：須勾選確認。先以探索者取代本系統管理的會員／特殊角色，保留其他角色與伺服器成員身分；再清除 Discord_id、Discord Verified At、Discord Credential Hash、Discord Tier Proof、Discord Role。Notion 會員、付費、交易量及 TG 資料保留。之後可由會員重新驗證。

## 擁有者啟用設定

本次僅修改程式與範例設定，不部署、不設定正式 secret、不執行真實解除或同步。

1. 由擁有者另外產生至少 32 個隨機字元的 secret，不重用 ADMIN_PASSWORD、Discord Bot token 或現有 AUTH_SECRET。
2. TG／後台 Worker 設定 `DISCORD_ADMIN_API_URL` 為 Discord Worker 的 HTTPS origin，例如 `https://<discord-worker>.<account>.workers.dev`，不含路徑、查詢、帳密；以 Worker secret 設定 `DISCORD_ADMIN_API_SECRET`。
3. DC Worker 以 Worker secret 設定相同值的 `ADMIN_API_SECRET`。保留既有 Notion、Bot token、DO、角色 ID。同步至兩端程式都包含本次變更後才使用按鈕。
4. 未完成 TG 設定時按鈕停用。DC secret 缺少／不足時，內部路由不開放。此功能不需要新增 Notion 欄位或 D1 migration；若 V2 已開啟，仍須有會員資格作業原有的 D1。
5. 由擁有者以指定測試會員核對：立即升降級、探索者及外部角色保留、解除後重新驗證、權限不足、Notion 暫時故障與重試。

TG 只持有獨立管理連線 secret，DC token 與驗證雜湊維持在 DC Bot；不送到瀏覽器。固定 `POST /internal/admin/member` 需 HMAC-SHA256 簽章、5 分鐘有效時間與嚴格資料格式，不提供公開會員查詢。

## 失敗與重試

- 每次操作核對畫面的 Discord ID／驗證時間及唯一綁定。資料變更時先重新整理，不對替代綁定執行舊操作。
- 解除意圖在改角色之前存入原有 DO 儲存空間。角色操作失敗、規則確認未完成時不清綁定；Notion 寫入失敗或結果不明時保留待辦，下次每 10 分鐘排程／管理員重試繼續處理。
- 待解除期間阻擋該會員／DC 帳號的新驗證與一般角色升級。發現身分已變更或重複綁定時停止，需人工核對；不自動處理別人的角色。
- 若 Notion 清除其實已完成、只是回應遺失，重試會核對五欄均已清除後完成待辦。已完成的請求 ID 回傳原結果，不再動新綁定。
- 後台不自動重送逾時請求；顯示「尚未確認完成」並重新載入核對。DC 端保存操作人、請求 ID、待辦建立時間與完成結果；後台最後處理紀錄保存操作人、時間與已確認／未確認回覆。若後台稽核寫入失敗，也不顯示已完成。

## 驗證範圍

Vitest 使用合成 Notion／Discord 邊界；workerd 模擬測試實際走簽章入口、DO RPC、角色處理、五欄清除、故障及中斷恢復。UI 預覽使用實際 React 元件與合成資料，不等於真實會員操作驗收。

本次驗證結果：後台／TG 341 項、DC Bot 196 項測試通過；兩端型別檢查、OpenNext Cloudflare build、Discord dry-run／V1／V2 workerd 及實際後台 HTTP client 的 workerd 測試通過。桌面與 390px 手機預覽使用合成資料，無水平溢出。獨立審查的 Cloudflare redirect 相容性與舊版待解除衝突問題均有 RED→GREEN 迴歸測試。未連線正式服務或部署。
