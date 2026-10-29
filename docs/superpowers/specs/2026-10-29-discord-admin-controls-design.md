# 後台 Discord 管理操作

使用既有會員詳細頁與管理員登入，新增「立即同步 DC 角色」及「解除 DC 綁定」。由 Discord Worker 執行角色與驗證資料操作；TG 後台仍不持有 Discord Bot token、不直接寫 Discord 驗證欄位。支援既有及 V2 規則，角色同步沿用目前 Bot 邏輯。

採兩個 Worker 間 HTTPS＋獨立共享 secret 的 HMAC 簽章，固定內部 POST 路由、五分鐘時效、嚴格 DTO、Durable Object 序列化與請求 ID 去重。未設定連線時按鈕停用。沒有公開會員查詢介面。直接把 Discord token 放入 TG 及僅改 Notion ID 的方案不採用，前者擴散憑證，後者可能留下會員角色。

同步操作核對畫面顯示的 Discord ID／驗證時間與唯一 Notion 綁定，重新讀取最新資格，立即執行既有角色同步。解除操作須在畫面確認，先恢復探索者、只移除本系統管理的高級角色，不踢人；成功後清除 ID、驗證時間、credential hash、tier proof、role result。付費、交易量、TG 資料保留。

解除意圖先持久保存；Discord 操作失敗不清綁定，Notion 結果不明時下次排程／重試核對並完成。待解除期間阻止重新驗證與一般升級。新綁定／帳號衝突時停止並要求覆核，不碰別人的角色。操作者、時間及結果留於內部操作紀錄與後台最後處理紀錄；雜湊不進 UI。所有測試使用合成資料，不部署、不呼叫真實服務。

PR #36 已合併，因此使用最新 main 的接續分支／新 PR 交付，不向 main 推送。
