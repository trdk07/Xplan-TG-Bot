# 會員資格 V2（200,000 U）

## 已確認規則與分工

TG 查推薦關係、歷史入金及交易量，Notion 保存會員事實，Discord 只配對及執行身分組。後台只呈現 DC 寫回的結果；捉妖小道獨立檢查有效付費／特殊會員，不以宇航員角色授權。

- 初次 TG 入群：推薦關係成立，歷史累積入金至少100 USDT；包含站內入金，提領不撤銷已通過資格，不把資金帳戶間劃轉當新入金。
- 每日台北09:00，統計前30個完整日 `[start,end)` 的現貨＋合約交易量；同一綁定帳號達200,000 USDT才升級，不跨帳號或交易所合計。
- 停用 > Partner/Exempt/VIP > 有效付費 > 交易量達標 > 免費。付款與交易量事實分開；付款到期時可轉中級，捉妖小道同時停止付費權限。
- 免費／停用保留探索者，付費／交易量／Exempt／VIP為宇航員，Partner為飛行員；不因會籍踢出TG或DC。新加入DC成員每10分鐘補授探索者，尊重規則篩選與既有角色。
- API失敗保留最後成功交易量資格並顯示過期／告警；不能以失敗值升級，也不能延長付費日期。7日、3日、到期／交易量降級通知按周期去重；結果不明需人工處理。

## Notion 欄位與相容

新寫入Status：`free`, `active_volume`, `active_paid`, `partner`, `exempt`, `VIP`, `suspended`。舊值保留讀取及遷移，不由程式刪除選項。入群進度另存Onboarding Step：collecting_info/eligible/join_pending/joined/needs_review。

新欄位的名稱／型態由 `scripts/membership-schema.mjs` 的離線與線上預覽輸出；與 `lib/membership-v2.ts` 的qualificationFields契約有測試對照。包括Admission Verified At、Verified Deposit USDT、Deposit Evidence Complete、人工覆核原因／人／時間、Volume Spot/Futures/Total 30D、Volume Qualified、統計起訖、成功時間及錯誤。`Volume Window End`為不含當日的截止點。

Paid At是人工付款核准時間；Review Due At只作付費截止。Subscription Months是最近一次購買月數，不能用它倒推所有歷史有效期限。有效期內提前續費從原截止日延長，過期從核准時間起算。

會員識別採canonical `mexc|bitget|okx`＋字串UID，Email再配對。新Notion交易所名稱為MEXC/Bitget/OKX；保留舊Mexc（抹茶）別名。不能以Number解析交易所UID。帳號換綁保留付費及Discord稽核資料，但清除入金／交易量／邀請證據，DC須重新驗證。

## D1與並行操作

`migrations/0001_membership_evidence.sql`包含：

- deposit_events：按交易所／UID／事件ID去重，金額用十進位字串；不使用SQL浮點SUM。
- notification_outbox：pending/sending/sent/unknown；傳送成功但Notion寫入失敗可修復標記，不重複送。sending/unknown不自動重送。
- qualification_locks：正規化Notion page ID的10分鐘租約，查核、付款申請／補件／核准、提醒與到期通知、人工資格調整／覆核／換綁共用；寫入前核對租約所有權。交易所單次能力查核預算2分鐘。
- membership_transitions：資格寫入前保存通知意圖，讓後台／TG重查或中斷後的升降級通知仍可由每日工作去重處理；通知前重新核對最新會籍。
- account_bindings：交換所／UID及page ID唯一保留，避免不同會員同時換綁同一帳號。Notion仍是會員資格資料來源。

直接在Notion換綁帳號不能取得應用程式租約，應暫停相關作業並透過後台換綁；不要手動搬移已驗證旗標。D1保留不是已通過入金的證明。若Notion更新失敗造成帳號保留待處理，先核對Notion與D1的現有所有者，再重試後台操作；不得任意刪除其他會員保留紀錄。

## 憑證、能力開關及未啟用項目

所有專案使用相同 `MEMBERSHIP_POLICY_V2_ENABLED=true`；未設定時維持相容模式。交易所憑證只放TG Worker Secrets，不放DC、官網、瀏覽器、Notion、測試或Git。

- MEXC_API_ACCESS_KEY / MEXC_API_SECRET_KEY（沿用現有名稱）。
- OKX_API_KEY / OKX_API_SECRET_KEY / OKX_API_PASSPHRASE。
- BITGET_API_KEY / BITGET_API_SECRET_KEY / BITGET_API_PASSPHRASE。
- DISCORD_INVITE_URL：有效的Discord伺服器邀請連結。
- 每家`MEXC|OKX|BITGET_ADMISSION_ENABLED=true`才開啟該家入群查核。
- 每家`*_VOLUME_ENABLED=true`且`*_VOLUME_UNIT_VERIFIED=true`、`*_VOLUME_COVERAGE_VERIFIED=true`、`*_VOLUME_WINDOW_VERIFIED=true`才允許交易量更新；全部預設關閉。

**MEXC完整現貨＋合約交易量尚無已確認來源，這次不呼叫真實MEXC測試。適配器會明確回報無完整來源，即使誤開旗標也不使用佣金明細來授權。**

Bitget正式啟用前仍須確認USDT換算、完整產品範圍；OKX須補非零樣本，確認自訂台北完整日及分類統計。不能用佣金成交額替代全量。Bitget只能補查最近90天入金，單次30天；部分歷史已證明100即可通過，不足則人工覆核；不明換算不猜算。

## 擁有者執行的上線順序

此PR不建立雲端資料庫、不修改真實Notion、不傳真實訊息、不部署。

1. 三個專案以V2關閉先部署相容版本，保留舊Status；確認官網與DC新交易所名稱相容。先備份會員資料。
2. 擁有者在TG Worker所屬帳號建立D1，將 `wrangler.membership-v2.jsonc.example` 的binding片段加入正式wrangler.jsonc並填真實database_id。部署前執行D1migration：`npx wrangler d1 migrations apply MEMBERSHIP_EVIDENCE_DB --remote`。該命令僅由擁有者於確認目標後操作。
3. 本機注入Notion憑證後先跑 `npm run membership:schema` 看新增預覽，再由擁有者執行`npm run membership:schema -- --apply`。另沿用既有`notion:ensure-schema`確認續費提醒日期欄位。
4. `npm run membership:migrate`只讀預覽，不寫入、不通知、不查交易所。逐一處理模糊付款、缺交易所、重複帳號與未綁定高級DC角色。舊試用轉免費並清試用日期；付款／提醒拆欄保留原紀錄；舊停用原因保留。
5. 確認相容讀取、角色權限、Server Members Intent及人工覆核後，由擁有者執行`npm run membership:migrate -- --apply --confirm-membership-v2`。版本變動的紀錄跳過再覆核，絕不猜付費。
6. 協調三個專案開啟V2，核對影子預覽／權限差異，先以人工確認會員驗收。捉妖小道API及Vite前端都要設定同名開關；DC保留既有DO migrations/Worker/Guild/角色ID。
7. 只有通過能力驗收的交易所才逐項開啟。其餘保持待覆核，不自動授權或降級。
8. 所有使用端與歷史紀錄遷移後，才由擁有者另行刪除不再使用的Status選項。

回退先關V2開關，保留新增欄位及D1，不反向猜測資料；切換過程暫停會籍寫入並核對捉妖小道權限，避免以舊寬鬆規則回退已收緊的存取。

## 驗證與交付

核心`npm test`、`npm run typecheck`、`npm run cf:build`；Discord獨立test/typecheck及Node24 workerd runtime smoke。三個專案各自PR，相關依賴連到其他PR；不合併、不手動部署。

離線預覽例：`npm run membership:migrate -- --input __tests__/fixtures/membership-migration.json --now 2026-10-28T01:00:00Z`。測試涵蓋100入金、199999.99/200000交易量、完整日、故障保留、到期轉級、身分／並行隔離與通知不明狀態。
