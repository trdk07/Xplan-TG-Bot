# Discord 會籍 V2 啟用說明

`MEMBERSHIP_POLICY_V2_ENABLED=true` 才啟用本文件的規則。預設 `false`，保留第一版的配對、試用／正式分類與撤權行為；`README.md` 原狀態表及歷史驗收紀錄屬於第一版。

## 資料與身分組

Discord 只讀 Notion 的會員資格，配對交易所＋UID＋Email，並同步身分組。推薦關係、入金、交易量 API 均由 TG 處理；Discord 不持有交易所密鑰、不計算或寫入資格，也不踢人。

| 優先順序與 Notion 事實 | Discord 結果 |
| --- | --- |
| `suspended`、舊 `kick`／`kicked`／`deny`／`denied`，或已封存紀錄 | 探索者；不授予付費、交易量或特殊資格 |
| `partner` | 飛行員；不受付款期限限制 |
| `exempt`／`VIP` | 宇航員；不受付款期限限制 |
| 有效 `Paid At` ≤ 現在，`Review Due At` > 現在，且付款日 < 到期日 | 宇航員，付費資格優先 |
| `Volume Qualified=true`，且有有效、非未來的 `Volume Checked At`、`Admission Verified At` | 宇航員，交易量資格 |
| 其他／缺少證據 | 探索者 |

`Status` 的一般值（`free`、`active_volume`、`active_paid` 等）是可延遲更新的標籤，不能單獨授權。舊 `MEMBER_TIER_OVERRIDES` 和舊類型證明不能補造 V2 的付款／交易量事實。付費到期後獨立檢查交易量；若仍達標，保留宇航員，否則改為探索者。付款到期的降級不依賴驗證證明 PATCH 成功；已通過身份驗證的 V2 綁定，特殊角色撤銷後的換組也先依目前事實處理，再更新類型稽核證明。

交易量失敗不清除最近成功事實；即使 `Volume Check Error` 非空且資料已舊，既有成功資格仍保留，直到 TG 的成功更新明確改變資格。只有錯誤、缺少成功日期或缺少入群審核日期，不得新增宇航員。

## Notion 欄位

保留現有 `Status`、`Exchange Name`（select）、`Exchange UID`（rich_text）、`Email`（email）、`Paid At`、`Review Due At`，及原有的 `Discord_id`（rich_text）、`Discord Verified At`（date）、`Discord Credential Hash`（rich_text）、`Discord Tier Proof`（rich_text）、`Discord Role`（select）。

V2 額外讀取以下 TG 維護的欄位；Discord 不寫入這些資格欄位：

| 精確欄位名稱 | 型別 |
| --- | --- |
| `Admission Verified At` | date |
| `Volume Qualified` | checkbox |
| `Volume Checked At` | date，最後一次成功 |
| `Volume Check Error` | rich_text |

`Volume Spot 30D`、`Volume Futures 30D`、`Volume Total 30D`、`Volume Window Start`／`Volume Window End`、`Qualification Checked At` 與入金證據欄位由 TG 維護；Discord 不需要重新推導交易量或入金數字。完整共用 schema 由核心會籍遷移提供，啟用前先以加欄方式完成，保留所有舊選項。

新配對使用 `mexc|bitget|okx`，Notion 中的 `MEXC`、`Mexc（抹茶）` 及大小寫別名視為 `mexc`，`Bitget`、`OKX` 也正規化。UID 一律字串，保留前置零，不轉數字。同交易所＋UID 必須唯一，再比對正規化 Email；帳號重複時即使 Email 不同也拒絕配對；不同交易所的相同 UID 可以各自配對。驗證及寫入前重新讀取身份，交易所改變也算衝突。

## 既有綁定遷移

V2 HMAC 將交易所一併綁定：`discord-member-v2`、Discord ID、canonical exchange、正規化 UID、正規化 Email。原有 Discord ID、會員頁面、DO class、DO 綁定與 migration tags 保留。

舊 V1 HMAC 只在目前交易所為 MEXC 相容身份、舊 credential HMAC 與舊 tier HMAC 都有效、有有效的原驗證時間，且目前唯一完整身份仍落在同一頁時自動升級；保留原 `Discord Verified At`。交換身份、無效／缺失證明、重複身份、遺失時間均要求重新驗證。非 MEXC 舊身份因 V1 未記錄交易所，必須互動重新配對，不能猜測。

手動更改 `Discord_id` 不能代替驗證。已明確綁定但身份證明失配的帳號降為探索者並要求重驗；同 Discord ID 多筆綁定、或已清除／封存而無有效綁定的高權限帳號，保留現有身分組並列入人工核對，不自動剝除。

## 每 10 分鐘與 Discord 設定

沿用 `*/10 * * * *`。先同步 Notion 已綁定會員，再分頁讀取 guild 成員；每頁 10 人，使用完整雪花 ID 字串，校驗游標遞增，避免單次 DO 操作超出外部請求預算。完成一頁後以游標繼續，直到最後一頁。分頁或 Notion 讀取失敗不被當成會員消失。

一般新成員完成規則確認後自動取得探索者。略過 bot、尚待規則確認者，以及已有任何受管理身分組者。授予前再次讀取目前成員，若已取得受管理角色、變為 bot 或規則確認未完成則略過；自動探索者流程只新增探索者，沒有移除角色操作。

未綁定但持有宇航員／飛行員或舊特殊角色者，記錄 `unbound_premium_role_review` 與 Discord ID 供營運核對；不自動剝除。這些日誌只有 Discord ID，不含 Email、UID、HMAC、token 或付款資訊。重複排程可能再次報告尚未處理的項目。

只改動設定的受管理角色，其餘角色保留。Discord 操作成功才回寫 `Discord Role`；寫入失敗由下次排程／手動更新重試。未完成規則確認或 Discord 操作失敗，不記錄新的角色成功結果。

啟用 guild 成員 REST 枚舉前，須在 Discord Developer Portal 開啟 **Server Members Intent**（大型應用程式可能需要批准）。V1 的互動驗證不需要此 privileged intent；V2 每 10 分鐘的成員枚舉需要。`discord:setup -- --check` 在 V2 檢查 application 的成員 intent flag，並沿用角色層級、非整合管理角色、普通會員權限檢查。HTTP `/healthz` 仍只代表服務存活，不代表 intent／權限完整。

`DISCORD_EXPLORER_ROLE_ID` 可選，優先於 `DISCORD_TRIAL_ROLE_ID`；未填時保留舊變數與既有探索者 ID。V2 的 `exempt`／`VIP` 統一使用 `DISCORD_MEMBER_ROLE_ID` 宇航員；舊 `DISCORD_NON_EXPIRING_ROLE_ID` 仍列為受管理角色以便換組，V1 行為不變。

## 分階段啟用

1. 先完成加欄式 Notion schema；保留付款、入金及交易量來源證據與所有舊狀態選項，不在 Discord 自動建立／改寫資格。
2. 部署相容讀取器，保持所有應用程式的 `MEMBERSHIP_POLICY_V2_ENABLED=false`。預覽遷移：將模糊歷史付款、過去試用、`kicked`／`denied` 以及未綁定的高權限 Discord 身分組逐筆核對。影子預覽不得發訊息或回寫資格。
3. 確認 Server Members Intent、Manage Roles、Bot 角色高於全部受管理會員角色，且會員角色不是整合管理角色也沒有管理權限。可先使用 `discord:setup -- --plan` 離線預覽，再經授權用 `--check` 唯讀核對。
4. 在 TG 與共用 Notion 事實已準備後，按整體切換計畫啟用 V2 消費端與寫入端。Discord 設定字串 `MEMBERSHIP_POLICY_V2_ENABLED=true`，再經授權發布 V2 入口文案。此程式變更本身不部署、不更改線上設定或 schema。
5. 用指定測試會員核對交易所配對、付費到期→交易量／探索者、特殊資格、免費與停權降級、規則確認、外部角色保留、Notion 回寫與重試，並處理人工核對名單。
6. 所有消費端完成遷移後，才另行規劃移除舊狀態選項。V2 已升級的 credential HMAC 不會被 V1 當成有效摘要；若回滾 V1，需依切換計畫重新驗證／還原先前備份，不能預期新版綁定自動降版。

## 本機驗證

`npm ci`、`npm test`、`npm run typecheck`、`npm run test:runtime`。最後一項只做 Worker dry-run 打包，並執行 V1／V2 兩個 workerd + KV-backed DO 的合成 API 測試，不連線真實 Notion 或 Discord、不寄送通知、不使用真實密鑰。
