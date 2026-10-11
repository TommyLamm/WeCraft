# Playroom 遊戲開發與發布指令

> 本檔為強制規範，不是參考資料。違反以下流程的修改視為未完成。
> 唯一準則是上游模板（blob 頁難讀，實作抓 raw 全文）：
> https://github.com/TommyLamm/playroom-platform/blob/main/templates/game-agent-template.md

## 0. 防過時（本節優先於以下所有內容）
- 上游模板及其指向的 `main` 文件永遠優先於本檔；衝突時以上游為準，並在回報中指出本檔哪句過時。
- 本檔不固定任何版本號：SDK／工具／schema 版本一律以動工時讀到的 `shared/versions.ts` 與模板為準。
- 下列文件清單僅為加速用的快取，模板增減文件時以模板 §1 為準。

## 1. 每次動工前必讀（不憑記憶，不設假設）
先讀模板全文，再跟著模板 §1 的連結逐份讀完（raw 形式：`https://raw.githubusercontent.com/TommyLamm/playroom-platform/main/<模板給的路徑>`）。
讀取後先列出「本次適用要求 + 驗收項目」才動手；讀取失敗就停手回報，不猜測、不宣稱符合。

## 2. 修改前先讀現況，不轉述假設
- `game.json`、`package.json`、`vite.config.ts`、`dist/`、`.github/workflows/`、`.playroom/` 先讀檔再下結論；派 subagent 時給驗證方法，不給「已知現狀」。
- `id` 固定不變；版本變更遵守 `v<version>` 一致、不覆寫已發布。

## 3. 完成前驗證門檻（有證據才算過）
- `npm run typecheck`、`npm test`、`npm run build` 全過
- 用 repo 內已 pinning 的固定工具（`.playroom/` 的 ZIP+lock，不自行指定版本）執行 `pack-game.mjs` + `validate-game.mjs` 全過
- 回報區分：程式完成 / ZIP 驗證 / Release / 平台上架；未做的列為未驗證，不推測通過。
- 無授權不推 tag、不建 Release、不調發布 API。