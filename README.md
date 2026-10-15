# WeCraft
### wecraft

> 瀏覽器裡的體素沙盒遊戲（Minecraft 類）—— TypeScript + Three.js，純前端、零後端。
> 創造／生存雙模式、日夜循環、怪物、合成、熔爐冶煉、IndexedDB 存檔＋雲端輕量進度。

# Synopsis

```bash
npm install
npm run dev        # 開啟 http://localhost:5173
```

標題畫面 →「單人遊戲」→ 點擊畫面鎖定指標 → 開挖。生存模式下天黑小心怪物。

# Description

一個用 TypeScript 撰寫、Three.js 渲染的體素（voxel）遊戲。世界由 16×16 區塊組成，
方塊經貪婪網格化（greedy meshing）+ texture array 合批繪製；三期開發皆已完成並通過
瀏覽器走查（第三期 13/13 項）。

## 遊戲特色

**世界**
- 區塊化地形（貪婪網格化 + `sampler2DArray` 紋理陣列，F3 顯示每幀三角數）
- 日 → 暮 → 夜 → 晝循環，天空、霧、光照同步變化
- 半透明水面 + 水下霧效
- 第三期：方塊太陽／月亮＋天空漸層、方形體積雲（可開關、會飄移）、即時陰影（可開關）、
  逐頂點 AO、霧色隨生物群系／時間變化

**創造模式**
- 即時挖掘、熱鍵欄無限方塊、無血量／飢餓
- 雙擊 Space 起飛，Space / Shift 升降

**生存模式**
- 血量／飢餓 HUD（心形 + 雞腿格）
- 挖掘需要時間，依工具速度表結算：不需工具的方塊（土、草、木板…）一律 1×、
  對應工具（鎬挖石、斧砍木）2×（鐵器 3×）、錯誤工具或空手挖石 0.5×
- 方塊挖破後掉落地面，走近自動拾取（熱鍵欄即全部背包）
- 夜晚出怪：殭屍近戰追擊、骷髏保持距離射箭；飢餓回血、墜落傷害
- 合成：背包 2×2（木板／木棍／工作台）＋ 放置工作台右鍵 3×3 製作工具，全套共
  13 份配方（木板／木棍／工作台＋木／石／鐵三階鎬斧劍＋熔爐）
- 石頭挖破掉鵝卵石（Minecraft 對應）：石製工具、熔爐配方與「鵝卵石」進度
  由此解鎖（挖掘工具無等級限制，任何鎬甚至空手都能挖礦，只有速度差異）
- 熔爐：放置後右鍵開啟，鐵礦／沙為冶煉原料、煤炭為燃料（原木、木板、
  木棍也可當燃料），每件冶煉 10 秒；鐵錠／玻璃取出即「燃燒吧」進度，
  鐵錠可做鐵製工具（鐵鎬挖鐵更快）
- 進食：殭屍近戰擊殺掉 1 顆蘋果（生存限定、必掉；骷髏不掉）→ 手持蘋果
  右鍵（對空或一般方塊）食用，回 4 點飢餓（滿 20 點）＋2.4 飽食度
  （飽時照吃，溢出浪費），解鎖「吃個蘋果」
- 死亡畫面 → 重生：血量飢餓回滿、回到出生點、物品保留（附死因文案：墜落／殭屍／骷髏／飢餓）
- 暫停選單可雙向切換創造／生存（創造進入會補滿 9×64 方塊）
- IndexedDB 存檔（`wecraft-save`，v1 照讀並升級 v2）：改動方塊 + 玩家狀態
  → Save & Quit → Continue 全還原；熔爐「方塊」隨世界改動保留，但爐內
  進行中的冶煉不存檔，Continue 後重置（爐內有物品時 toast「熔爐進度已重置」）；
  v1 舊檔 Continue 後進度全鎖（新系統起算）
- 第三期：程序化音效（挖掘／放置／腳步／風聲／鳥叫，音量設定、背景分頁自動靜音）、
  挖掘裂紋＋破壞粒子、第一人稱手持模型（挖掘揮動）、進度系統＋右上 toast 通知
  （第四期再添鐵器／冶煉／進食三進度，累計 12 項）

**雲端進度（Playroom，輕量）**
- 同步內容＝種子、玩家位置與視角、血量／飢餓、遊戲時間、背包物品、進度、
  個人設定；體素世界的方塊改動仍只存本機 IndexedDB（不上傳）
- 訪客可玩：未登入照常遊戲＋本機存檔，只是不上傳雲端
- 正式世界載入即讀檔、每 60 秒檢查點＋Save & Quit 時上傳；管理預覽
  （moderation preview）下讀寫皆走隔離槽、重開清除，不碰正式帳號
- 衝突處理：revision 分叉時第二次上傳報 `SAVE_REVISION_CONFLICT`，
  遊戲重讀雲端並套用（toast「雲端有新進度，已同步」），暫停選單顯示
  「有新進度」行＋重試；單槽 64 KiB 上限，超限只 toast
  「雲端空間不足，僅本機存檔」，遊戲不受影響
- 雲端格式版本 1；讀到無法解讀的資料或格式即停用雲端寫入、本機照常
  （不覆寫既有雲端存檔、不當機）

**介面**
- 熱鍵欄、背包、合成介面、熔爐面板、暫停選單、死亡畫面（皆純 DOM，由 `main.ts`
  注入回呼通訊，不 import bus／Three）
- F3 調試疊層：FPS、XYZ 座標、Block、Chunks、Seed、Triangles、Mode

## 操作

| 操作 | 功能 |
|---|---|
| 點擊畫面 | 鎖定指標進入遊戲 |
| 滑鼠 | 視角轉動 |
| W / A / S / D | 移動 |
| Space | 跳躍 / 飛行上升（創造：雙擊起飛） |
| Shift | 潛行（移速變慢）/ 飛行下降 |
| Ctrl | 疾跑 |
| 左鍵 | 挖掘（按住連續挖）/ 攻擊 |
| 右鍵 | 放置方塊 / 右鍵工作台開 3×3 |
| 1–9 / 滾輪 | 熱鍵欄切換 |
| E | 背包（生存模式含 2×2 合成格；創造隱藏合成） |
| Esc | 暫停選單（解鎖指標） |
| F3 | 調試資訊開關 |
| F5 | 切換視角（第一/第三人稱） |

## 架構

```
src/
├── core/     遊戲狀態與純邏輯：bus、items、inventory、recipes、settings、日夜數學
├── world/    世界與模擬：區塊、貪婪 mesher、raycast、drops、mobs、IndexedDB 存檔
├── player/   玩家：AABB 物理、血量飢餓、挖掘互動、輸入
├── render/   Three.js：場景、光照、區塊網格、紋理陣列（唯一的 3D 層）
├── ui/       純 DOM/CSS：HUD、選單、背包、合成、死亡畫面
└── main.ts   組合根（composition root）
```

架構紅線（review + grep 強制）：

- `core/` `world/` `player/` 不得 import Three.js 或碰 DOM（`player/input.ts` 的
  事件監聽為既有例外）
- Three.js 只出現在 `render/` 與 `main.ts`
- `ui/` 不得 import `bus` singleton（由 main 注入）
- Runtime 依賴只有 `three`；其餘皆為 devDependencies
- 測試與來源同置：`src/**/*.test.ts`（jsdom 為全域環境）

# Example

一次典型的生存開局：

```text
1. 標題畫面 →「單人遊戲」（新世界，seed 1337 預設）
2. 砍樹拾原木 → E 背包 2×2 合成木板／木棍／工作台 → 放置工作台 → 右鍵 3×3 做木鎬
3. 帶木鎬挖石頭（掉鵝卵石，「鵝卵石」進度）→ 3×3 做石鎬 → 挖鐵礦＋煤炭（「鐵礦」進度）
4. 8 顆鵝卵石做熔爐 → 放置 → 右鍵開爐：鐵礦＋煤炭 → 10 秒冶煉 → 取出鐵錠
   （「燃燒吧」進度）→ 做鐵鎬（「鐵製工具」進度）
5. 夜晚持劍殺殭屍 → 拾蘋果 → 手持對空右鍵吃掉（「吃個蘋果」進度）
6. Esc → Save & Quit；再次進入 →「繼續遊戲」→ 位置、方塊、血量、時間全數還原
   （熔爐方塊還在；爐內未取出的冶煉進度會重置）
7. Esc → Game Mode: Creative → 雙擊 Space 起飛勘察地形；切回生存自動落地
```

# Install

從原始碼安裝（`package.json` 標記 `private: true`，未發布至 npm）：

```bash
git clone <repo-url>
cd wecraft
npm install
npm run dev        # 開發伺服器
npm run build      # 類型檢查 + 產出 dist/
npm run preview    # 預覽產出
```

# Test

```bash
npm test           # vitest run — 742 tests / 47 files 全綠
npm run test:watch # watch 模式
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
```

# 專案狀態

- **Phase 1**（創造沙盒、地形、互動）與 **Phase 2**（生存模式全套）皆完成並合入 `master`。
- **Phase 3**（0.2.0：陰影／AO／雲／天空／音效／粒子／手持／進度／死因）完成並通過最終驗證，
  成品 `dist/`（`game.zip` 驗證通過、尚未發布）。
- **Phase 4**（0.3.0：雲端輕量進度＋生存縱深：熔爐冶煉／鐵器三件／殭屍蘋果／進食／
  三新進度／IDB v1→v2 相容）完成並通過最終驗證（742 tests / 47 files、
  typecheck／lint／build 全綠、pinned 工具 pack＋validate 通過、瀏覽器走查見本任務回報）。
- 需求文件：`docs/superpowers/specs/2026-09-23-wecraft-design.md`
- Phase 2 執行計畫（17 任務 + 走查證據）：`docs/superpowers/plans/2026-09-24-wecraft-phase2.md`
- Phase 4 執行計畫（10 任務）：`docs/superpowers/plans/2026-10-11-wecraft-phase4.md`

# License

尚未聲明（repo 內目前無 LICENSE 檔）。
