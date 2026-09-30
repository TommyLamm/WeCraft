# WeCraft
### wecraft

> 瀏覽器裡的體素沙盒遊戲（Minecraft 類）—— TypeScript + Three.js，純前端、零後端。
> 創造／生存雙模式、日夜循環、怪物、合成、IndexedDB 存檔。

# Synopsis

```bash
npm install
npm run dev        # 開啟 http://localhost:5173
```

標題畫面 →「單人遊戲」→ 點擊畫面鎖定指標 → 開挖。生存模式下天黑小心怪物。

# Description

一個用 TypeScript 撰寫、Three.js 渲染的體素（voxel）遊戲。世界由 16×16 區塊組成，
方塊經貪婪網格化（greedy meshing）+ texture array 合批繪製；兩期開發皆已完成並通過
瀏覽器走查（11/11 項）。

## 遊戲特色

**世界**
- 區塊化地形（貪婪網格化 + `sampler2DArray` 紋理陣列，F3 顯示每幀三角數）
- 日 → 暮 → 夜 → 晝循環，天空、霧、光照同步變化
- 半透明水面 + 水下霧效

**創造模式**
- 即時挖掘、熱鍵欄無限方塊、無血量／飢餓
- 雙擊 Space 起飛，Space / Shift 升降

**生存模式**
- 血量／飢餓 HUD（心形 + 雞腿格）
- 挖掘需要時間，依工具速度表結算：不需工具的方塊（土、草、木板…）一律 1×、
  對應工具（鎬挖石、斧砍木）2×、錯誤工具或空手挖石 0.5×
- 方塊挖破後掉落地面，走近自動拾取（熱鍵欄即全部背包）
- 夜晚出怪：殭屍近戰追擊、骷髏保持距離射箭；飢餓回血、墜落傷害
- 合成：背包 2×2（木板／木棍／工作台）＋ 放置工作台右鍵 3×3 製作工具（9 份配方）
- 死亡畫面 → 重生：血量飢餓回滿、回到出生點、物品保留
- 暫停選單可雙向切換創造／生存（創造進入會補滿 9×64 方塊）
- IndexedDB 存檔（`wecraft-save`）：改動方塊 + 玩家狀態 → Save & Quit → Continue 全還原

**介面**
- 熱鍵欄、背包、合成介面、暫停選單、死亡畫面（皆純 DOM，經 `bus` 與遊戲核心通訊）
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
2. E 開背包 → 方塊面板取橡木木板到選中格 → 2×2 合成木棍與工作台
3. 選中工作台 → 右鍵放置地面 → 右鍵工作台開 3×3 → 木鎬
4. 帶鎬挖石頭（2×，比空手快 4 倍）→ 天色轉暗，準備過夜
5. Esc → Save & Quit；再次進入 →「繼續遊戲」→ 位置、方塊、血量、時間全數還原
6. Esc → Game Mode: Creative → 雙擊 Space 起飛勘察地形；切回生存自動落地
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
npm test           # vitest run — 529 tests / 28 files 全綠
npm run test:watch # watch 模式
npm run typecheck  # tsc --noEmit
npm run lint       # eslint .
```

# 專案狀態

- **Phase 1**（創造沙盒、地形、互動）與 **Phase 2**（生存模式全套）皆完成並合入 `master`。
- 需求文件：`docs/superpowers/specs/2026-09-23-wecraft-design.md`
- Phase 2 執行計畫（17 任務 + 走查證據）：`docs/superpowers/plans/2026-09-24-wecraft-phase2.md`

# License

尚未聲明（repo 內目前無 LICENSE 檔）。
