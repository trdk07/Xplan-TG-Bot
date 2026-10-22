# Discord 驗證部署核對

更新：2026-09-13（Asia/Taipei）

## 目前正式版本

- Worker：`xplan-discord-verification`。
- 版本：`a5bb8593-cd75-4209-934d-e6d77908a9ba`。
- 健康檢查：[healthz](https://xplan-discord-verification.jason-541.workers.dev/healthz)，HTTP 200 且回報 `membershipStore: notion`。
- Discord 互動端點：`https://xplan-discord-verification.jason-541.workers.dev/interactions`。無簽章 POST 回傳 401。
- 唯一啟用的 Durable Object 為 `NotionMemberGate`，已透過 Cloudflare API 核對 `use_sqlite: false`。
- 舊 SQLite `MemberGate` namespace 已刪除；程式不再使用 SQL 或 SQLite。
- 每 10 分鐘從 Notion 讀取綁定會員，執行權限同步。
- Bot Token、Notion integration token、AUTH_SECRET 保留於 Worker Secrets，未重新產生 AUTH_SECRET。

## Notion 欄位

重用 `Discord_id`（Text）。新增並讀回確認以下三個欄位，原有欄位 ID 均完整保留：

| 欄位 | 型別 | 內容 |
| --- | --- | --- |
| `Discord Verified At` | Date | 驗證時間 |
| `Discord Credential Hash` | Text | 綁定 Discord 帳號的 Exchange ID＋Email HMAC |
| `Discord Tier Proof` | Text | 當期會員類型的校驗值 |

2026-09-13 另新增唯一的 `Discord Role`（Select），選項為探索者／宇航員／飛行員。此欄記錄角色操作結果，不取代 `Status` 或用來授權。

共用 `Status`、`Review Due At`、`Paid At`、`Payment Deadline At`、`Email`、`Exchange UID`。不新增重複的會員狀態、到期日、付款日或個人資料副本。校驗值不保存日期明文或日期副本。

Notion 是唯一會員與完成綁定資料來源。非 SQLite 的 KV 工作狀態只用於限流、互動去重、未完成寫入的重試及撤權追蹤；它不能自行授予會員資格。

## 遷移與驗證

- 透過暫時的 HMAC 保護遷移端點，讀取舊 SQLite 的綁定資料。結果：`checked: 0`、`migrated: 0`、完成，無既有綁定需要搬移。
- 確認後使用 v3 migration 刪除舊 namespace，移除橋接程式並恢复正常驗證。
- 正式 Cloudflare API 再次核對：此 Worker 僅剩 `NotionMemberGate`，`use_sqlite: false`，舊 `MemberGate` 不存在。
- 臨時 `/internal/notion-cutover` 已移除，POST 回傳 404。
- 最終版本 88 項測試、TypeScript 檢查、Worker 打包及 workerd 完整流程測試通過。完整測試使用 `useSQLite: false`，Notion／Discord API 全部使用合成資料攔截。
- 覆蓋：唯一配對、並行搶綁、寫入結果不確定時禁止改綁、跨重啟限流／去重、從 Notion 重建同步、提醒階段類型校驗、日期換期、身份資料變更、清除／封存綁定後撤權、Notion 中斷，以及到期撤權不依賴 PATCH。
- 已核對一名真實 `partner` 會員自行提交表單後的 Notion 綁定與有效憑證，並確認修正版透過正式排程成功授予角色；尚未另行驗收修正版的全新表單成功回覆畫面。

## 2026-09-09 驗證時間精度修正

- 使用者回報驗證服務暫時無法完成。實際記錄的 Discord ID 與憑證摘要已寫入且校驗有效，正式角色尚未授予。
- 已用該筆驗證時間實測：送入含秒／毫秒的時間，Notion 回傳同一分鐘的整分時間；測試後原儲存時間維持不變，未修改會員狀態或共用到期日。
- 原本嚴格比較毫秒造成 `notion-write-unconfirmed`，待重試操作也反覆失敗。修正僅將 `Discord Verified At` 正規化至分鐘；保留身份與會員期限的完整校驗。
- 回歸測試先在舊程式重現失敗，再確認修正後通過；完整流程的 Notion mock 也改為模擬實際的時間精度。
- 新版本部署後，2026-09-09 16:10（Asia/Taipei）正式排程回報 `membership_sync_complete`、`checked: 1`、`errors: 0`、`source: notion`。Discord API 隨後確認該會員已取得「宇航員」、沒有試用角色，完成先前待重試的綁定；沒有手動授予角色。

## 2026-09-10 Partner 身分組修正

- `trial_active` →「探索者」；`active_paid`、`eligible`、`exempt` →「宇航員」；`partner` →「飛行員」。狀態比對忽略大小寫與前後空白；`partner`、`exempt` 沿用免續費規則。
- 新增 `DISCORD_PARTNER_ROLE_ID=1524807192434311390`，將「飛行員」納入授予、換組與失效撤權。只增刪受管理的會員角色，保留其他角色。
- 既有 `partner` 綁定在下一次同步時更新原有 `Discord Tier Proof` 並換組，不必重新驗證；未新增 Notion 屬性，也未修改會員狀態或共同期限。
- 97 項測試、TypeScript 檢查、Worker 打包與完整 workerd 測試通過。涵蓋五種指定狀態的實際角色 ID、舊 `non_expiring` 校驗值升級、Partner／Exempt 切換、失效撤權及重複同步不重寫 Notion。執行後端仍是非 SQLite 的 `NotionMemberGate`。
- 正式 Discord 唯讀檢查通過：Bot 最高角色位置 19，高於「飛行員」位置 16；三個會員角色皆可管理。「飛行員」本身沒有管理權限。
- 已部署上述版本；正式 `/healthz` HTTP 200 並回報 `membershipStore: notion`，未簽章 `/interactions` HTTP 401。部署後的即時角色讀回仍為上一版的「宇航員」；既有 Partner 等待下次每 10 分鐘排程或自行按「更新身分組」，本次未手動授予角色。

## 2026-09-13 身分組結果寫回 Notion

- 以資料庫 schema 確認原本沒有 Discord 角色欄位；新增 `Discord Role` 後重新讀回，所有原有屬性 ID 與型別維持不變。提供 `scripts/notion-role-setup.mjs --check|--apply`，既有欄位會重用。
- 綁定 PATCH 保留原四個驗證欄位；Discord 成功操作後才以另一個 PATCH 寫入單一角色結果欄位。重複同步角色不變時不寫入。到期／封鎖撤權成功或確認會員已離開伺服器時清空有效綁定的結果。
- Discord 失敗時不寫入成功角色；規則確認尚未完成或人工審核狀態不記錄新授權。Notion 結果寫入失敗時保留成功的 Discord 操作，顯示專用重試訊息，下次從最新資料重試；撤權發生在結果寫入之前。
- 結果欄位不參與授權，也不另外保存角色 ID、會員狀態或期限副本。寫入前再核對 page 與 Discord 綁定，避免把結果寫到已換綁的會員。手動解除綁定或封存原頁面後，該頁結果可能保留歷史值。
- 106 項測試、TypeScript 檢查與完整 workerd 流程測試通過，涵蓋寫入先後順序、失敗不記錄、換組、撤權、Notion 重試、未完成規則確認、離群及變更綁定。清除 lockfile 中失效的暫存建置路徑項目後 `npm ci` 通過；實際套件版本和 integrity 均未變更。
- 已部署上述版本，正式 `/healthz` HTTP 200（`membershipStore: notion`），未簽章 `/interactions` HTTP 401；Discord Bot／頻道／角色權限唯讀檢查通過。
- 使用部署相同版本的 Notion adapter 對一名既有 Partner 做正式寫入驗收：先驗證既有綁定憑證與目前會員資格，再從 Discord API 讀回唯一受管理角色「飛行員」，以 `writeRole` 寫入並讀回 `Discord Role=飛行員`。未執行 Discord 角色變更，身份資料、校驗值與共同日期均保持原值。此為 adapter 正式 API 驗收，尚未另外觀察新版本的排程或使用者互動事件；其他既有綁定由下一輪同步補寫。

## Discord 設定

- 伺服器：`1524719558504747039`。
- 驗證頻道：`1524855788340776987`。
- Application：`1546535242851029072`（Xplan管理員）。
- 試用角色：探索者 `1524805277231222994`。
- 正式角色：宇航員 `1524806322401448026`。
- Partner 角色：飛行員 `1524807192434311390`。
- `/verify` 指令：`1546785759942410310`。
- 驗證入口訊息：`1546785760957571085`。
- [開啟驗證入口](https://discord.com/channels/1524719558504747039/1524855788340776987/1546785760957571085)。
- 2026-09-09 唯讀檢查通過 Bot 管理角色權限、角色層級與驗證頻道權限；本次未重新發布入口訊息。

## 頻道權限的先前核對

2026-09-08 快照：未驗證成員可以查看驗證入口；@everyone 可查看 15 個文字／公告／論壇類頻道，單獨加上探索者或宇航員額外可見的此類頻道数均為 0。此為先前核對，不代表目前最新頻道配置。本次未修改頻道覆寫。
