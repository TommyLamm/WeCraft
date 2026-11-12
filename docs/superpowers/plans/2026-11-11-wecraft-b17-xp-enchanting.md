# WeCraft B17 經驗與附魔 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把經驗循環（經驗球／等級／HUD／四種來源／存檔）與它的用途（附魔台＋五種附魔＋完整存檔鏈）做成 0.20.0。

**Architecture:** 純邏輯模組（`core/experience`、`world/xp-orbs`、`world/xp-awards`、`core/enchantments`）＋渲染工廠（`render/xp-orbs`）＋UI 工廠（`ui/xp-hud`、`ui/enchanting`），全部在組裝根 `src/main.ts` 接線；`main.ts` 不可 import（jsdom 會炸），接線由 `main.wiring.test.ts` 以 `?raw`＋AST 釘住。

**Tech Stack:** TypeScript strict、Three.js 0.170、Vite 5、Vitest 2（jsdom）、既有 pinned Playroom 工具鏈。

**Spec:** `docs/superpowers/specs/2026-11-11-wecraft-xp-enchanting-design.md`（母規格：`docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`）

## Global Constraints

- 本機 `SavePayload` 維持 **v6**、雲端維持 **format 4**、`game.json` 的 `cloudSave` 一字不動；`xp` 與 `ItemStack.ench` 都是**附加欄位**（舊版讀到會忽略／清洗，不新增回退阻擋）。
- 方塊 id append-only：`BLOCK.ENCHANTING_TABLE = 49`；tile `T.ENCHANTING_TOP = 50`、`T.ENCHANTING_SIDE = 51`、`TILE_COUNT = 52`（硬上限 64）。
- 新 `ItemId`：`enchanting_table`（第 116 個）；配方 69 → 70；進度 20 → 22。
- 經驗曲線：`level<16: 2L+7`、`level<31: 5L−38`、`else: 9L−158`；`MAX_LEVEL = 100`。
- 來源點數：煤 1／鐵 1／金 2／鑽 4；殭屍／骷髏／苦力怕／蜘蛛 5；雞 1／豬 2／羊 2／牛 3；冶煉每件 1；釣魚 魚 2／垃圾 1／寶物 5。創造模式不發經驗、不掉落。
- 附魔上限：efficiency 5、sharpness 5、protection 4、unbreaking 3、fortune 3；**每件物品最多一個附魔**（可升級）；創造模式附魔免費。
- 效果：efficiency `+L²+1` 挖掘速度；sharpness `+1+0.5(L−1)` 傷害；protection 每級 +1 護甲點（合計上限 80%）；unbreaking 不扣機率 `L/(L+1)`；fortune `floor(L/2)` 保證＋奇數級 50% 再 +1。
- 純邏輯模組不得 import Three／DOM；`main.ts` 的改動一律要 `main.wiring.test.ts` 釘子。
- 提交訊息格式：`feat(b17): …` / `fix(b17): …` / `test(b17): …` / `docs(b17): …`。
- 每個 Task 完成前必跑：受影響測試檔＋`npm run typecheck`；控制器在批次末跑全套 `npm test`、`npm run lint`、`npm run build`、`npm run test:perf`、pinned pack＋validate。
- 版本 0.20.0；**不推 tag、不建 Release、不呼叫平台 API**。

## Review Focus

1. **不可信存檔／雲端資料**（`xp`、`ench` 是字串／NaN／負數／小數／超過上限／原型鍵）— 期待：正規化或整筆丟棄、永不拋錯、NaN 不得流入 HUD 或傷害計算。測試放在 Task 1／7／9。
2. **經驗數學邊界**（dt=0/NaN、發 0 或負經驗、等級 100、花超過持有的等級、rng 回 0/1、經驗球上限、死亡／暫停／創造時吸收）— 期待：安全無變化。測試放在 Task 1／2／6。
3. **附魔橫跨奇怪路徑**（Q 丟棄、箱子噴出、合成格歸還、容器游標、盔甲穿脫、雲端 409 合併、模式 stash、熔爐）— 期待：附魔不消失、不複製。測試放在 Task 9／10。
4. **附魔選項有效性**（面板開著時等級變動、物品被換掉、已達上限、不相容物品、創造免費、同一選項連點）— 期待：拒絕無效操作、不扣不該扣的等級。測試放在 Task 12。
5. **場次轉換**（新局→0 經驗、讀檔／雲端還原、創造↔生存切換 HUD 顯隱、死亡重生不清經驗）— 期待：一致。測試放在 Task 6／7。

---

### Task 1: 經驗模型 `core/experience.ts`

**Files:**
- Create: `src/core/experience.ts`
- Test: `src/core/experience.test.ts`

**Interfaces:**
- Consumes: 無。
- Produces（後續所有 Task 依賴）：
  - `export interface Experience { level: number; xp: number }`
  - `export const MAX_LEVEL = 100;`
  - `export function createExperience(): Experience`
  - `export function xpToNext(level: number): number`
  - `export function addExperience(exp: Experience, amount: number): Experience`
  - `export function spendLevels(exp: Experience, n: number): Experience`
  - `export function experienceProgress(exp: Experience): number`
  - `export function normalizeExperience(raw: unknown): Experience`
  - `export function parseXpOverride(query: string): number | null`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL, addExperience, createExperience, experienceProgress,
  normalizeExperience, parseXpOverride, spendLevels, xpToNext,
} from './experience';

describe('experience curve', () => {
  it('matches the vanilla segments at their boundaries', () => {
    expect(xpToNext(0)).toBe(7);
    expect(xpToNext(15)).toBe(37);   // 2*15+7
    expect(xpToNext(16)).toBe(42);   // 5*16-38
    expect(xpToNext(30)).toBe(112);  // 5*30-38
    expect(xpToNext(31)).toBe(121);  // 9*31-158
    expect(xpToNext(MAX_LEVEL)).toBe(742);
  });
  it('clamps a junk level into 0..MAX_LEVEL', () => {
    expect(xpToNext(-3)).toBe(7);
    expect(xpToNext(2.9)).toBe(11);
    expect(xpToNext(1e9)).toBe(742);
  });
});

describe('addExperience', () => {
  it('carries points across a level-up into a fresh object', () => {
    expect(addExperience({ level: 0, xp: 0 }, 10)).toEqual({ level: 1, xp: 3 });
  });
  it('returns the same reference for non-positive or non-finite amounts', () => {
    const exp = { level: 2, xp: 1 };
    expect(addExperience(exp, 0)).toBe(exp);
    expect(addExperience(exp, -5)).toBe(exp);
    expect(addExperience(exp, NaN)).toBe(exp);
    expect(addExperience(exp, Infinity)).toBe(exp);
  });
  it('stops at MAX_LEVEL and discards the remainder', () => {
    expect(addExperience({ level: MAX_LEVEL - 1, xp: xpToNext(MAX_LEVEL - 1) - 1 }, 1000))
      .toEqual({ level: MAX_LEVEL, xp: 0 });
    const maxed = { level: MAX_LEVEL, xp: 0 };
    expect(addExperience(maxed, 50)).toBe(maxed);
  });
});

describe('spendLevels', () => {
  it('spends whole affordable levels and resets the bar', () => {
    expect(spendLevels({ level: 5, xp: 3 }, 2)).toEqual({ level: 3, xp: 0 });
  });
  it('rejects unaffordable or non-integer amounts with the same reference', () => {
    const exp = { level: 2, xp: 1 };
    expect(spendLevels(exp, 3)).toBe(exp);
    expect(spendLevels(exp, 0)).toBe(exp);
    expect(spendLevels(exp, 1.5)).toBe(exp);
    expect(spendLevels(exp, NaN)).toBe(exp);
  });
});

describe('experienceProgress', () => {
  it('returns a 0..1 fraction and 0 at the cap', () => {
    expect(experienceProgress({ level: 0, xp: 0 })).toBe(0);
    expect(experienceProgress({ level: 0, xp: 3.5 })).toBeCloseTo(0.5);
    expect(experienceProgress({ level: MAX_LEVEL, xp: 0 })).toBe(0);
  });
});

describe('normalizeExperience', () => {
  it('repairs junk into an integer level and in-range xp', () => {
    expect(normalizeExperience(null)).toEqual({ level: 0, xp: 0 });
    expect(normalizeExperience('x')).toEqual({ level: 0, xp: 0 });
    expect(normalizeExperience({ level: '2', xp: 3 })).toEqual({ level: 0, xp: 0 });
    expect(normalizeExperience({ level: 2.7, xp: 3.9 })).toEqual({ level: 2, xp: 3 });
    expect(normalizeExperience({ level: -5, xp: 99 })).toEqual({ level: 0, xp: 6 });
    expect(normalizeExperience({ level: 1, xp: 99 })).toEqual({ level: 1, xp: 8 });
    expect(normalizeExperience({ level: MAX_LEVEL, xp: 5 })).toEqual({ level: MAX_LEVEL, xp: 0 });
  });
});

describe('parseXpOverride', () => {
  it('parses ?xp=<non-negative integer> and rejects junk', () => {
    expect(parseXpOverride('?xp=500')).toBe(500);
    expect(parseXpOverride('?a=1&xp=0')).toBe(0);
    expect(parseXpOverride('?xp=-3')).toBeNull();
    expect(parseXpOverride('?xp=1.5')).toBeNull();
    expect(parseXpOverride('?xp=abc')).toBeNull();
    expect(parseXpOverride('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/experience.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/experience.ts`**

實作要點：`xpToNext` 先把 `level` 以 `Number.isFinite` 檢查、`Math.floor`、夾 0..`MAX_LEVEL`；`addExperience` 用 while 迴圈逐級進位（`if (exp.xp + amount >= need) { amount -= need - exp.xp; level += 1; xp = 0 } else { xp += amount; amount = 0 }`），到上限時直接回傳（含「已滿等輸入」的同參考早退）；`normalizeExperience` 先驗物件、`level` 為有限數才取整（非數 → 0）、`xp` 為有限數才取整（非數 → 0）、上限夾到 `xpToNext(level)-1`；`parseXpOverride` 用 `URLSearchParams`（`query` 可含或不含 `?`），值必須是 `/^\d+$/` 才回整數，否則 null。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/experience.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/experience.ts src/core/experience.test.ts
git commit -m "feat(b17): 經驗模型（曲線／等級／消費／清洗／?xp= 解析）"
```

---

### Task 2: 經驗球純邏輯 `world/xp-orbs.ts`

**Files:**
- Create: `src/world/xp-orbs.ts`
- Test: `src/world/xp-orbs.test.ts`

**Interfaces:**
- Consumes: 無（可參考 `src/world/drops.ts` 的物理形狀，但**不得 import**）。
- Produces：
  - `export interface XpOrb { id: number; value: number; pos: {x,y,z}; vel: {x,y,z}; age: number; pickupDelay: number }`
  - 常數：`ORB_GRAVITY = 20`、`ORB_HORIZONTAL_DRAG_PER_SEC = 0.1`、`ORB_SETTLE_OFFSET = 0.01`、`ORB_BOUNCE_THRESHOLD = 3`、`ORB_SPAWN_PICKUP_DELAY = 0.3`、`ORB_PICKUP_RADIUS = 1.2`、`ORB_MAGNET_RADIUS = 4`、`ORB_MAGNET_DELAY = 0.5`、`ORB_MAGNET_SPEED = 9`、`ORB_MERGE_RADIUS = 2.5`、`ORB_DESPAWN_AGE = 300`、`MAX_XP_ORBS = 128`、`MAX_ORB_VALUE = 32767`
  - `export function spawnXpOrbs(orbs: readonly XpOrb[], value: number, pos, opts?: { vel?: {x,y,z} }): XpOrb[]`
  - `export function stepXpOrbs(orbs: readonly XpOrb[], dt: number, playerPos: {x,y,z}, isSolidAt: (x,y,z)=>boolean): { orbs: XpOrb[]; collected: number }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  MAX_ORB_VALUE, MAX_XP_ORBS, ORB_DESPAWN_AGE, ORB_MAGNET_DELAY, ORB_MAGNET_RADIUS,
  ORB_PICKUP_RADIUS, spawnXpOrbs, stepXpOrbs,
} from './xp-orbs';

const neverSolid = (): boolean => false;
const floorAt = (level: number) => (x: number, y: number, z: number) => y <= level;

describe('spawnXpOrbs', () => {
  it('merges into the nearest orb within range and saturates at MAX_ORB_VALUE', () => {
    const base = spawnXpOrbs([], 3, { x: 0, y: 5, z: 0 });
    const near = [{ ...base[0], pos: { x: 1, y: 5, z: 0 }, value: MAX_ORB_VALUE - 1 }];
    const out = spawnXpOrbs(near, 5, { x: 0, y: 5, z: 0 });
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(MAX_ORB_VALUE);
  });
  it('ignores non-positive or non-finite values (same reference)', () => {
    const orbs: never[] = [];
    expect(spawnXpOrbs(orbs, 0, { x: 0, y: 0, z: 0 })).toBe(orbs);
    expect(spawnXpOrbs(orbs, -1, { x: 0, y: 0, z: 0 })).toBe(orbs);
    expect(spawnXpOrbs(orbs, NaN, { x: 0, y: 0, z: 0 })).toBe(orbs);
  });
  it('caps the array at MAX_XP_ORBS by merging into the nearest orb', () => {
    let orbs = spawnXpOrbs([], 1, { x: 0, y: 5, z: 0 });
    for (let i = 1; i < MAX_XP_ORBS; i++) {
      orbs = spawnXpOrbs(orbs, 1, { x: 0, y: 5, z: 0 }); // 全部合併成 1 顆
      // 手動散開，讓下一顆不會自動合併
      orbs = orbs.map((o, idx) => ({ ...o, pos: { x: idx * 100 + 100, y: 5, z: 0 } }));
    }
    expect(orbs).toHaveLength(MAX_XP_ORBS);
    const capped = spawnXpOrbs(orbs, 7, { x: 0, y: 5, z: 0 });
    expect(capped).toHaveLength(MAX_XP_ORBS);
  });
});

describe('stepXpOrbs', () => {
  it('falls with gravity and settles on solid ground without tunneling', () => {
    let orbs = spawnXpOrbs([], 1, { x: 0.5, y: 8, z: 0.5 });
    for (let i = 0; i < 50; i++) orbs = stepXpOrbs(orbs, 0.1, { x: 40, y: 4, z: 0 }, floorAt(4)).orbs;
    expect(orbs[0].pos.y).toBeCloseTo(5.01, 2); // 吸附到地面格上緣 + settle
    expect(orbs[0].vel.y).toBe(0);
  });
  it('ignores magnetism until ORB_MAGNET_DELAY, then homes at ORB_MAGNET_SPEED', () => {
    const far = [{ value: 1, id: 0, pos: { x: 0, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: 0, pickupDelay: 0 }];
    const early = stepXpOrbs(far, 0.1, { x: 2, y: 5, z: 0 }, neverSolid);
    expect(early.orbs[0].pos.x).toBeLessThan(0.01);
    const late = [{ ...far[0], age: ORB_MAGNET_DELAY }];
    const moving = stepXpOrbs(late, 0.1, { x: 2, y: 5, z: 0 }, neverSolid);
    expect(moving.orbs[0].pos.x).toBeGreaterThan(0.5);
  });
  it('collects within ORB_PICKUP_RADIUS and sums the collected value', () => {
    const orbs = [
      { value: 3, id: 0, pos: { x: 0, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: 10, pickupDelay: 0 },
      { value: 4, id: 1, pos: { x: ORB_PICKUP_RADIUS + 2, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: 10, pickupDelay: 0 },
    ];
    const out = stepXpOrbs(orbs, 0.1, { x: 0, y: 4, z: 0 }, neverSolid);
    expect(out.collected).toBe(3);
    expect(out.orbs).toHaveLength(1);
  });
  it('despawns at ORB_DESPAWN_AGE and ignores non-finite dt', () => {
    const old = [{ value: 1, id: 0, pos: { x: 0, y: 5, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: ORB_DESPAWN_AGE, pickupDelay: 0 }];
    expect(stepXpOrbs(old, 0.1, { x: 0, y: 0, z: 0 }, neverSolid).orbs).toHaveLength(0);
    const nano = stepXpOrbs(old, NaN, { x: 0, y: 0, z: 0 }, neverSolid);
    expect(nano.orbs).toHaveLength(1);
    expect(nano.collected).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/world/xp-orbs.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: Implement `src/world/xp-orbs.ts`**

實作重點（可參照 `drops.ts` 的 `stepDrops` 物理，但保持獨立常數）：
- `spawnXpOrbs`：驗證 `value` 為有限整數 ≥1；在 `ORB_MERGE_RADIUS` 內挑最近球合併；否則新增（`id = max+1`、`vel = opts?.vel ?? {x: Math.random()*2-1, y: 2.5, z: Math.random()*2-1}`、`pickupDelay = ORB_SPAWN_PICKUP_DELAY`）；已達 `MAX_XP_ORBS` 時改合併進最近的球（若找不到最近的——不可能為空——才丟棄）。
- `stepXpOrbs`：`dt` 非有限或 ≤0 → `{ orbs: [...orbs], collected: 0 }`（新陣列但內容同參考即可）；逐球：`age += step`、`pickupDelay -= step`；`age >= ORB_DESPAWN_AGE` → 移除；已達 `pickupDelay<=0` 且距離（腳點到 `playerPos.y + 1` 眼高）≤ `ORB_PICKUP_RADIUS` → 累加 `collected` 並移除；否則若 `age >= ORB_MAGNET_DELAY` 且距離 ≤ `ORB_MAGNET_RADIUS` → 朝眼點等速 `ORB_MAGNET_SPEED * step` 移動（不套重力、不吸附地面；抵達後由下一幀的吸收分支處理）；否則重力＋積分＋水平阻力＋cell sweep 地面吸附（同 `stepDrops`；反彈一次 0.3）。
- 全程不得對未載入區塊寫任何東西（純函式，本來就不寫世界）。

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/world/xp-orbs.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/world/xp-orbs.ts src/world/xp-orbs.test.ts
git commit -m "feat(b17): 經驗球實體邏輯（合併／重力／磁吸／吸收／上限）"
```

---

### Task 3: 經驗球渲染 `render/xp-orbs.ts`

**Files:**
- Create: `src/render/xp-orbs.ts`
- Test: `src/render/xp-orbs.test.ts`

**Interfaces:**
- Consumes: `XpOrb`（Task 2）。
- Produces：`export interface XpOrbView { syncOrbs(orbs: readonly XpOrb[], camera: THREE.Camera, dt: number): void; dispose(): void }`、`export function createXpOrbRenderer(scene: THREE.Scene): XpOrbView`。

- [ ] **Step 1: Write the failing tests**（真 `THREE.Scene`，不碰 WebGL；比照 `src/render/fishing.test.ts`）

案例（名稱＋斷言）：
- `adds one mesh per orb and keys them by id` — 2 球 → scene 內 2 個 `Mesh`，`name` 含 id。
- `updates positions with a bob and rotates while dt > 0` — `syncOrbs(..., 0.1)` 後 mesh.position 與 orb.pos 差異 ≤ 0.1；rotation.y > 0；`dt = 0` 再 sync rotation 不變。
- `removes meshes for vanished orbs` — 空陣列 sync → 0 個 Mesh。
- `dispose removes every mesh`。

- [ ] **Step 2: Run to fail**：`npx vitest run src/render/xp-orbs.test.ts` → module not found。

- [ ] **Step 3: Implement**

要點：共享 `BoxGeometry(0.25, 0.25, 0.25)`＋`MeshBasicMaterial({ color: 0x9bff5a })`；id-keyed `Map<number, THREE.Mesh>`；`syncOrbs` 先移除不存在的 id、再 upsert（`mesh.position.set(pos.x, pos.y + 0.5 + 0.08*Math.sin(age*4), pos.z)`；`if (dt > 0) mesh.rotation.y += dt * 3`）；`dispose` 清除所有 mesh 並 dispose geometry/material 各一次。

- [ ] **Step 4: Run tests + typecheck**：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/render/xp-orbs.ts src/render/xp-orbs.test.ts
git commit -m "feat(b17): 經驗球渲染器（小發光方塊／浮動／自轉）"
```

---

### Task 4: 經驗來源表 `world/xp-awards.ts`

**Files:**
- Create: `src/world/xp-awards.ts`
- Test: `src/world/xp-awards.test.ts`

**Interfaces:**
- Consumes: `BLOCK`（`world/blocks`）、`MobKind`（`world/mobs`）、`PassiveKind`（`world/passive-mobs`）、`FishingCatch['category']`（`world/fishing`）——**型別匯入即可**。
- Produces：
  - `export type XpMobKind = MobKind | PassiveKind;`
  - `export function xpForOre(blockId: number): number`（coal 1／iron 1／gold 2／diamond 4／其餘 0）
  - `export function xpForMob(kind: XpMobKind): number`（zombie 5／skeleton 5／creeper 5／spider 5／chicken 1／pig 2／sheep 2／cow 3／未知 0）
  - `export function xpForFishing(category: 'fish' | 'junk' | 'treasure'): number`（2／1／5）
  - `export function xpPerSmelt(): number`（`1`）

- [ ] **Step 1: Write the failing tests**（表驅動；逐項斷言上列精確值，未知 id／kind 回 0）

- [ ] **Step 2: Run to fail**：`npx vitest run src/world/xp-awards.test.ts`。

- [ ] **Step 3: Implement**（小型 lookup；未知 → 0；不得拋錯）。

- [ ] **Step 4: Run tests + typecheck**：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/world/xp-awards.ts src/world/xp-awards.test.ts
git commit -m "feat(b17): 經驗來源表（礦物／生物／釣魚／冶煉）"
```

---

### Task 5: 經驗 HUD 與 F3

**Files:**
- Create: `src/ui/xp-hud.ts`
- Test: `src/ui/xp-hud.test.ts`
- Modify: `src/ui/ui.css`（追加 `.xp-bar`／`.xp-bar-fill`／`.xp-level` 規則，放在底部 HUD 帶狀註解區附近）
- Modify: `src/ui/hud.ts`（`DebugLinesParams` 加 `xp: string`；`formatDebugLines` 在 `Weather:` 後、`Triangles:` 前插入 `Xp: ${p.xp}`）
- Modify: `src/ui/ui.test.ts`（F3 順序釘子＋底部帶狀幾何釘子）

**Interfaces:**
- Consumes: `Experience`（Task 1）。
- Produces：`export function createXpHud(uiRoot: HTMLElement): { set(exp: Experience | null): void; dispose(): void }`；
  DOM：`div.xp-bar > div.xp-bar-fill`、`div.xp-level`；`set(null)` → 兩個節點 `display:none`；`set(exp)` → 顯示、等級文字 `String(level)`、fill 寬度 `${Math.round(progress*100)}%`；**同值不重寫**（快取等級與百分比）。

- [ ] **Step 1: Write the failing tests**

案例：
- `renders the level and fill percentage` — `set({level:3,xp:3})`（`xpToNext(3)=13` → 23%）→ `.xp-level` 文字 `3`、`.xp-bar-fill` 寬 `23%`。
- `hides both nodes for null and shows them again`。
- `does not rewrite the DOM when nothing changed` — 以 `MutationObserver` 或在節點上記錄上次值（測試可比較 `element.style.width` 寫入次數：先手動把 width 改成 `99%`，再 `set` 同值 → 不得被改回；changed value → 會被改）。
- `removes both nodes on dispose`。

- [ ] **Step 2: Run to fail**：`npx vitest run src/ui/xp-hud.test.ts src/ui/ui.test.ts`（ui.test 既有 `formatDebugLines` 相關測試會因新參數型別而紅；先在測試檔的 base params helper 補 `xp` 欄位並更新順序斷言，這一步是刻意的紅）。

- [ ] **Step 3: Implement**（模組＋CSS；CSS 用 `position: fixed`，`bottom: 66px`、`width: 364px`、`height: 4px`、`border: 1px solid #000`、`background: #1b1b1b`；`.xp-level` `bottom: 71px`、置中、`font: 700 11px/1 monospace`、`color: #7ef23c`、`text-shadow: 1px 1px 0 #000`、`pointer-events: none`、`z-index: 6`）。

- [ ] **Step 4: 更新 `ui.test.ts` 幾何釘子**：新增 `the xp bar sits between the hotbar and the vitals row`（`.xp-bar` bottom ≥ 66、`bottom + height(含 border 6px) ≤ 72`）與 `.xp-bar-fill` 寬度規則存在；F3 順序釘子改成 `Weather < Xp < Triangles`。

- [ ] **Step 5: Run tests + typecheck**：`npx vitest run src/ui/xp-hud.test.ts src/ui/ui.test.ts && npm run typecheck` → PASS。

- [ ] **Step 6: Commit**

```bash
git add src/ui/xp-hud.ts src/ui/xp-hud.test.ts src/ui/ui.css src/ui/hud.ts src/ui/ui.test.ts
git commit -m "feat(b17): 經驗條 HUD 與 F3 的 Xp 行"
```

---

### Task 6: 主線經驗接線（狀態／來源／球／HUD／音效／session）

**Files:**
- Modify: `src/main.ts`
- Modify: `src/main.wiring.test.ts`
- Modify: `src/audio/voices.ts`、`src/audio/voices.test.ts`、`src/audio/index.ts`、`src/audio/index.test.ts`
- Test: 上述既有測試檔＋新增接線釘子

**Interfaces:**
- Consumes：Task 1–5 的所有匯出；`isSolidAt` 用 main 既有給 `stepDrops` 的同一個回呼（若它是行內箭頭，抽成區域常數重用）。
- Produces（main 內部）：
  - `let experience: Experience`、`let xpOrbs: XpOrb[]`、`let xpSoundAcc: number`
  - `function setExperience(next: Experience): void`（單一變更路徑：指派＋HUD 顯示（創造 → `xpHud.set(null)`）＋等級上升時 `applyAdvancement({type:'level', level, mode})`（Task 12 才加事件；本 Task 先只比對等級，Task 12 再補）
  - `function awardXpAt(amount: number, pos: {x,y,z}): void`（生存且 `amount >= 1` 才做：`experience = addExperience(experience, amount)`；`xpOrbs = spawnXpOrbs(xpOrbs, amount, pos)`；`setExperience(experience)`）
  - `function awardDeathXp(...)` 在各死亡 helper 內用迴圈呼叫 `awardXpAt(xpForMob(kind), mobPos)`

- [ ] **Step 1: 音效 voice＋facade 測試先行**

`voices.test.ts` 新案例 `playXpPickup builds an oscillator with a short bright envelope`（比照 `chirp` 測試：OscillatorNode 有 `start`/`stop`、frequency ≥ 800Hz、gain envelope 收尾 0）；`index.test.ts` 新案例 `playXpPickup routes through the master bus and is inert before start`。
實作：`voices.ts` 新增 `export function xpPickup(ctx, dest, volume = 1): void`（單一 osc，1200→1800Hz 上滑 0.08 秒，gain 0.15 → 0）；`index.ts` 的 `GameAudio` 介面新增 `playXpPickup(opts?: PlayOptions): void`，樣板照 `playBowShoot`（distance gain、inert before start）。

- [ ] **Step 2: main 接線（實作）**

依序：
1. import：`createExperience/addExperience/parseXpOverride`、`spawnXpOrbs/stepXpOrbs`、`xpForOre/xpForMob/xpForFishing/xpPerSmelt`、`createXpHud`、`createXpOrbRenderer`。
2. 建立 `const xpHud = createXpHud(uiRoot);`（在既有 HUD 建立區附近）、`const xpOrbRenderer = createXpOrbRenderer(gs.scene);`（在 renderer 建立區附近）。
3. 狀態＋`setExperience`＋`awardXpAt`。
4. **挖礦**：在破壞分支 `world.setBlock(...)` 成功後、`spawnBlockDrop` 之前：`awardXpAt(xpForOre(id), { x: hit.x + 0.5, y: hit.y + 0.5, z: hit.z + 0.5 });`。
5. **擊殺**：`spawnMobDeathDrops` 內 `if (opts.killedByPlayer !== false)` 逐隻 `awardXpAt(xpForMob(d.kind), center)`（`dead` 就是 `Mob[]`）；`spawnB9DeathDrops` 內 `if (killedByPlayer)`；`spawnPassiveDeathDrops` 簽名改為 `(dead, killedByPlayer = true)`，兩處呼叫端：近戰擊殺傳預設 true、爆炸路徑（`dropsForDeaths` 前的死亡過濾支）傳 `false`。
6. **冶煉**：`takeFurnaceOutput` 在 `giveItem` 成功後：`awardXpAt(xpPerSmelt() * out.count, { x: entity.x + 0.5, ... })`。
7. **釣魚**：`tryReelFishing` 在 `caught` 非 null 的 `giveItem` 之後：`awardXpAt(xpForFishing(caught.category), bobber)`。
8. **每幀球步驟**：放在 drops 步驟區塊（`stepDrops`／pickup）正後方、particles 之前：
   ```ts
   const orbStep = stepXpOrbs(xpOrbs, dt, player.position, solidAt);
   xpOrbs = orbStep.orbs;
   if (orbStep.collected > 0) {
     experience = addExperience(experience, orbStep.collected);
     setExperience(experience);
     xpSoundAcc += dt;
     if (xpSoundAcc >= 0.15) { xpSoundAcc = 0; audio.playXpPickup(); }  // 本地音、不需 pos
   }
   ```
9. **渲染尾巴**：`xpOrbRenderer.syncOrbs(xpOrbs, gs.camera, state === 'playing' ? dt : 0);` 緊接 `dropRenderer.syncDrops(...)` 之後。
10. **session**：`resetSessionEntities()` 加 `xpOrbs = [];`；`startGame()` 加 `experience = xpOverride !== null ? addExperience(createExperience(), xpOverride) : createExperience(); setExperience(experience);`（`const xpOverride = parseXpOverride(location.search);` 放模組層）。
11. **模式切換**：在 consolidated `mode-changed` handler 內呼叫 `setExperience(experience)`（生存顯示、創造隱藏）。
12. **debug hooks**：`xpState(): { level; xp; need }`、`orbs(): number`。

- [ ] **Step 3: 接線釘子（main.wiring.test.ts）**

新 describe `main.ts 接線（B17：經驗）`：
- `countOf('stepXpOrbs(') === 1`、`countOf('xpOrbRenderer.syncOrbs(') === 1`；
- `blockAfter('const orbStep = stepXpOrbs(')` 之後的程式碼含 `xpOrbs = orbStep.orbs`（AST：`findAssignmentCall` 或字串）與 `setExperience(`；
- `countOf('awardXpAt(') === 7`（1 個函式宣告 ＋ 6 個呼叫點：挖礦 1／三種死亡 helper 3／熔爐 1／釣魚 1；helper 內用迴圈逐隻呼叫同一個 `awardXpAt`）；
- `functionBody('resetSessionEntities')` 含 `xpOrbs = [];`；
- `functionBody('startGame')` 含 `parseXpOverride` 或 `xpOverride` 與 `setExperience(`；
- `audio.playXpPickup(` 恰好 1 處；`countOf('audio.play(') === 8` **不變**；
- debug 介面含 `xpState`、`orbs`。

- [ ] **Step 4: Run focused tests + typecheck**

Run: `npx vitest run src/main.wiring.test.ts src/audio/voices.test.ts src/audio/index.test.ts && npm run typecheck` → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/main.wiring.test.ts src/audio/voices.ts src/audio/voices.test.ts src/audio/index.ts src/audio/index.test.ts
git commit -m "feat(b17): 經驗主線接線（四種來源／球步進／HUD／音效／session）"
```

---

### Task 7: 經驗存檔（本機＋雲端＋還原路徑）

**Files:**
- Modify: `src/world/save.ts`、`src/world/save.test.ts`
- Modify: `src/core/cloud-save.ts`、`src/core/cloud-save.test.ts`、`src/core/cloud-merge.test.ts`
- Modify: `src/main.ts`、`src/main.wiring.test.ts`
- Modify: fixture 檔（`src/ui/session-boundary.test.ts` 的 `SaveSources` 建構、`src/core/cloud-save.test.ts` 的 `baseSrc`／`rawValid`）

**Interfaces:**
- Consumes: `normalizeExperience`（Task 1）；main 的 `experience`／`setExperience`（Task 6）。
- Produces：
  - `SavePayloadV6['player']` 追加 optional `xp?: Experience`；`SavePayloadWithPassiveMobs['player']` 追加**必填** `xp: Experience`；`SaveSources.player` 追加**必填** `xp: Experience`。
  - `collectSavePayload` 寫 `xp: normalizeExperience(args.player.xp)`；`loadGame` 讀 `player.xp` → 一律正規化回傳。
  - `CloudData` 追加 optional `xp?: Experience`；`CloudBuildSource` 追加 optional `xp?: Experience`（預設 level 0）；`buildCloudData` 寫、`acceptCloudData` 一律回傳正規化值、`validateCloudData` 對 `xp` 做「非陣列物件」輕量檢查（髒 → 整包拒收，比照 `armor`）、`mergeCloudData` 用**本機** `xp`（加進顯式輸出物件）。
  - main：`sessionSavePayload` 的 `player` 加 `xp: experience`；`continueGame`／`applyCloudData` 還原 `experience = normalizeExperience(payload.player.xp)`／`normalizeExperience(data.xp)`＋`setExperience(...)`；`saveCloudNow` 的 `buildCloudData` 來源加 `xp: experience`。

- [ ] **Step 1: 測試先行（save）**

`save.test.ts` 新案例：
- `a v6 record without player.xp loads as level 0`（fixture 拿掉 xp → deep-equal `{level:0,xp:0}`）。
- `player.xp round-trips through collectSavePayload and loadGame`（`{level:7,xp:3}`）。
- `junk player.xp normalizes instead of rejecting the record`（`xp:'x'`、`xp:{level:1.5,xp:999}` → 正規化；`isValidSavePayload` 仍然接受）。
- `the save version stays 6`（`collectSavePayload(...).version === 6`）；既有的「v7 被拒」釘子**不動**。

- [ ] **Step 2: 測試先行（cloud）**

`cloud-save.test.ts` 新案例：
- `format 4 payloads without xp accept as level 0`（`expect('xp' in accepted!).toBe(true)` 且值為 `{level:0,xp:0}`）。
- `xp round-trips through buildCloudData and acceptCloudData`。
- `a non-object xp rejects the whole payload`（`acceptCloudData({...rawValid(), xp: 'x'})` → null）。
- `the format version and readable formats stay at 4`（既有格式釘子更新註解、值不變）。
`cloud-merge.test.ts` 新案例 `keeps the LOCAL xp and never takes the remote one`。

- [ ] **Step 3: 測試先行（main 接線）**

`main.wiring.test.ts` 新案例：
- `findObjectLiteralCall('sessionSavePayload','collectSavePayload')` 的 `player` 物件含 `xp` 且值為識別字（非 `{level:0,xp:0}` 字面值）；
- `functionBody('continueGame')` 與 `functionBody('applyCloudData')` 皆含 `experience =` 與 `setExperience(`；
- `findObjectLiteralCall('saveCloudNow','buildCloudData')` 的來源物件含 `xp`。

- [ ] **Step 4: 實作＋修正所有 fixture（typecheck 會紅：`SaveSources`／`CloudBuildSource` 必填欄位）**

包含 `src/ui/session-boundary.test.ts` 的兩個 fixture 與 `save.test.ts` 的 `sourcesOf`。

- [ ] **Step 5: Run focused tests + typecheck**

Run: `npx vitest run src/world/save.test.ts src/core/cloud-save.test.ts src/core/cloud-merge.test.ts src/ui/session-boundary.test.ts src/main.wiring.test.ts && npm run typecheck` → PASS。

- [ ] **Step 6: Commit**

```bash
git add -A src/world/save.ts src/world/save.test.ts src/core/cloud-save.ts src/core/cloud-save.test.ts src/core/cloud-merge.test.ts src/main.ts src/main.wiring.test.ts src/ui/session-boundary.test.ts
git commit -m "feat(b17): 經驗走本機與雲端存檔（附加欄位、格式不動）"
```

---

### Task 8: 附魔純邏輯 `core/enchantments.ts`

**Files:**
- Create: `src/core/enchantments.ts`
- Test: `src/core/enchantments.test.ts`

**Interfaces:**
- Consumes: `ItemStack`／`ItemId`（型別匯入）、`ArmorSet`（型別匯入，**不得 runtime import**）。
- Produces：
  - `export type EnchantmentId = 'efficiency' | 'sharpness' | 'protection' | 'unbreaking' | 'fortune';`
  - `export interface Enchantment { id: EnchantmentId; level: number }`
  - `export const ENCHANTMENT_MAX_LEVELS: Readonly<Record<EnchantmentId, number>>`
  - `export const ENCHANTMENT_NAMES: Readonly<Record<EnchantmentId, string>>`
  - `export function compatibleEnchantments(item: ItemId): EnchantmentId[]`
  - `export function normalizeEnchantment(raw: unknown): Enchantment | undefined`
  - `export function sanitizeEnchantFor(item: ItemId, raw: unknown): Enchantment | undefined`
  - `export interface EnchantOffer { enchant: Enchantment; cost: number }`
  - `export function rollEnchantOffers(stack: ItemStack, rng?: () => number): EnchantOffer[]`
  - `export function applyEnchant(stack: ItemStack, enchant: Enchantment): ItemStack`
  - `export function efficiencyBonus(stack: ItemStack | null): number`
  - `export function sharpnessBonus(stack: ItemStack | null): number`
  - `export function protectionLevels(set: ArmorSet): number`
  - `export function unbreakingAvoidChance(stack: ItemStack | null): number`
  - `export function fortuneBonus(level: number, rng?: () => number): number`
  - `export function enchantmentName(e: Enchantment): string`
  - `export function stackDisplayName(stack: ItemStack): string`

- [ ] **Step 1: Write the failing tests**（要涵蓋 Review Focus #1/#4 的純函式面）

案例：
- 相容表：`compatibleEnchantments('diamond_pickaxe')` → `['efficiency','fortune','unbreaking']`（固定順序）、`'iron_sword'` → `['sharpness','unbreaking']`、`'golden_axe'` → `['efficiency','sharpness','unbreaking']`、`'diamond_helmet'` → `['protection','unbreaking']`、`'bow'`／`'fishing_rod'`／`'flint_and_steel'` → `['unbreaking']`、`'stick'`／`'diamond'` → `[]`；並釘住「盔甲 id 集合與 `armor.test` 的 `ARMOR_ITEM_IDS` 一致」（測試可 import 兩邊比對）。
- `normalizeEnchantment`：合法；`{id:'efficiency',level:0}`→undefined；level 99 → 夾到 5？**明確**：超過上限 → `undefined`（不可信輸入寬鬆度以「丟棄」為主；升級路徑由 `rollEnchantOffers` 控制），非整數 → undefined，未知 id／原型鍵（`__proto__`）→ undefined。
- `sanitizeEnchantFor('diamond_helmet', {id:'efficiency',level:1})` → undefined（不相容）；`sanitizeEnchantFor('diamond_pickaxe', {id:'fortune',level:99})` → `{id:'fortune',level:3}`（**in-range 夾到上限**——與上條的差別：這裡是清洗既有資料，寬鬆修復；`normalizeEnchantment` 是嚴格驗證）。
- `rollEnchantOffers`：
  - 無附魔鎬＋rng 序列 → 3 個選項，`cost = 1/2/3`、`level = 1/2/3`、id 都在相容清單內；
  - rng 固定 0 → 每個 tier 都選相容清單第一個；
  - `{ench:{id:'efficiency',level:2}}` → 單一升級選項 `{level:3, cost:3}`；
  - 已達上限 → `[]`；不相容物品 → `[]`。
- 效果：efficiency L5 → 26；sharpness L1 → 1、L5 → 3；`unbreakingAvoidChance` L1 → 0.5、L3 → 0.75、無附魔 → 0；`protectionLevels` 只加合規盔甲格；`fortuneBonus(1, rng0)` → 1（50% 中）、`rng0.99` → 0、`bonus(2)` → 1、`bonus(3, rng0)` → 2。
- `applyEnchant` 回傳新物件、不動輸入；`enchantmentName({id:'efficiency',level:3}) === 'Efficiency III'`；`stackDisplayName({item:'diamond_pickaxe',count:1,ench:...})` 含 `✦`。

- [ ] **Step 2: Run to fail**：`npx vitest run src/core/enchantments.test.ts`。

- [ ] **Step 3: Implement**（自行持有 id 清單：`TOOL_IDS`（5 材質×4 種＝20）、`WEAPON_IDS`（劍 5＋斧 5）、`PICKAXE_IDS`、`ARMOR_IDS`（16）；不 import `armor.ts`／`interact.ts` 以免 runtime cycle）。

- [ ] **Step 4: Run tests + typecheck**：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/enchantments.ts src/core/enchantments.test.ts
git commit -m "feat(b17): 附魔純邏輯（相容表／選項／效果／顯示名）"
```

---

### Task 9: `ItemStack.ench` 貫穿所有堆疊路徑

**Files:**
- Modify: `src/core/items.ts`（`ItemStack.ench?: Enchantment`；`sanitizeStack` 保留合法 `ench`）
- Modify: `src/core/inventory.ts`（ctor／`addItem`／`setSlot` 保留 `ench`；`addItem` 合併條件加「附魔相同」；`addItem` 第 4 參數 `ench?`）
- Modify: `src/world/drops.ts`（`DropEntity.ench?`、`SpawnDropOptions.ench?`、`spawnDrop` 寫入、`pickup` 傳給 `addItem`）
- Modify: `src/core/armor.ts`（`normalizeArmorSet` 保留 `ench`）
- Modify: `src/world/block-entities.ts`（`sameStack` 比 `ench`；`spillBlockEntity` 傳 `ench`）
- Modify: `src/core/cloud-save.ts`（`normalizeCloudStack` 保留 `ench`）
- Modify: `src/world/furnace.ts`（`stepFurnace` 的三處產物重建改用 `{ ...output, count: ... }` 保留附加欄位；加註解說明可熔物本身不可能是附魔物）
- Modify: `src/ui/crafting.ts`（`onGiveBack(item, dur?, ench?)`；staging／減一用 spread 保留欄位）
- Modify: `src/ui/inventory.ts`（`rightClickSlot` 三處手動重建補 `ench`）
- Modify: `src/main.ts`（`giveItem(item, count, dur?, ench?)`、`giveStack`、`dropSelected`、`dropAtPlayer`、`inventoryParams`／`containerParams` 的歸還與 take 路徑帶 `ench`）
- Test: `src/core/enchant-persistence.test.ts`（新增）、上述模組各自的 `.test.ts`、`src/main.wiring.test.ts`

**Interfaces:**
- Consumes: `sanitizeEnchantFor`／`Enchantment`（Task 8）。
- Produces：
  - `ItemStack` 新增 optional `ench`。
  - `InventoryModel.addItem(item, count, dur?, ench?)`。
  - `DropEntity`／`SpawnDropOptions` 新增 optional `ench`。
  - `giveItem(item, count, dur?, ench?)` 與 `giveStack(stack: ItemStack): number`（main 內部）。
  - `onGiveBack(item, dur?, ench?)`。

- [ ] **Step 1: Write the failing integration test** `src/core/enchant-persistence.test.ts`

```ts
const enchanted: ItemStack = { item: 'diamond_pickaxe', count: 1, dur: 100, ench: { id: 'efficiency', level: 3 } };

it('sanitizeStack keeps a legal enchant and drops junk', () => {
  expect(sanitizeStack(enchanted)).toEqual(enchanted);
  expect(sanitizeStack({ ...enchanted, ench: { id: 'nope', level: 1 } })!.ench).toBeUndefined();
  expect(sanitizeStack({ ...enchanted, ench: { id: 'sharpness', level: 1 } })!.ench).toBeUndefined(); // 不相容
});
it('the inventory model keeps ench through ctor, setSlot and addItem', () => { ... });
it('an enchanted stack survives a drop spawn/pickup round-trip', () => {
  let drops = spawnDrop([], 'diamond_pickaxe', 1, { x: 0, y: 0, z: 0 }, { dur: 100, ench: enchanted.ench });
  const model = createInventoryModel(new Array(36).fill(null), 'survival');
  const out = pickup(drops, 0, model);
  expect(model.slots[0]).toMatchObject({ item: 'diamond_pickaxe', dur: 100, ench: enchanted.ench });
  expect(out.drops).toHaveLength(0);
});
it('cloud build/accept/merge keep ench', () => { ... buildCloudData → acceptCloudData → mergeCloudData(local) ... });
it('armor normalization keeps protection on the right slot', () => { ... });
it('a chest keeps ench through normalizeBlockEntity and serializeBlockEntities', () => { ... });
```

- [ ] **Step 2: Run to fail**：`npx vitest run src/core/enchant-persistence.test.ts`。

- [ ] **Step 3: Implement**（逐檔照 Files 清單；每個手動重建點改成 spread 或補 `ench`；`sanitizeStack` 以 `sanitizeEnchantFor(item, s.ench)` 產生 optional 欄位；有 `ench` 的堆疊**永不與不同附魔合併**）。

- [ ] **Step 4: 補各模組測試**（`items.test.ts`：sanitize 保留／丟棄案例；`inventory.test.ts`：同附魔合併、不同附魔不合併、setSlot 保留；`drops.test.ts`：spawnDrop／pickup 保留；`armor.test.ts`：normalize 保留；`block-entities.test.ts`：sameStack 偵測附魔差異、spill 保留；`cloud-save.test.ts`：normalizeCloudStack 保留；`crafting.test.ts`／`ui.test.ts`：合成格 staging／歸還保留附魔；`furnace.test.ts`：狀態清洗保留附加欄位）。

- [ ] **Step 5: 接線釘子**：`main.wiring.test.ts` 驗證 `giveStack(` 存在且 `giveItem` 呼叫點沒有在帶 `ench` 的路徑上退化成三參數（以代表性案例：`functionBody('dropAtPlayer')` 含 `stack.ench`；`functionBody('inventoryParams')` 或 `craftingParams` 的 `onGiveBack` 傳 `ench`）。

- [ ] **Step 6: Grep 稽核（寫進報告）**

Run: `rg -n "item: [a-zA-Z]+, count:" src --glob '!*.test.ts'` 與 `rg -n "count: .* - 1|count: .*\+ 1" src --glob '!*.test.ts'`，逐一確認每個堆疊重建點都保留 `ench`（或明確不需要，附理由）。

- [ ] **Step 7: Run focused tests + typecheck** → PASS。

- [ ] **Step 8: Commit**

```bash
git add -A src/core src/world src/ui src/main.ts src/main.wiring.test.ts
git commit -m "feat(b17): ItemStack.ench 貫穿背包／掉落／盔甲／塊實體／雲端／UI"
```

---

### Task 10: 附魔效果接線

**Files:**
- Modify: `src/player/interact.ts`（`toolSpeed` 加 efficiency；新增 `meleeDamageFor(held: ItemStack | null)`；`spawnBlockDrop` 加 fortune）
- Modify: `src/core/durability.ts`（`damageStack(stack, amount, rng?)` 加 unbreaking）
- Modify: `src/core/armor.ts`（`absorbArmorDamage` 加 `protectionLevels`）
- Modify: `src/main.ts`（近戰改用 `meleeDamageFor(slots[selected])`）
- Test: 上述模組的 `.test.ts`、`src/main.wiring.test.ts`

**Interfaces:**
- Consumes: `enchantments.ts` 的效果函式（Task 8）＋ `ItemStack.ench`（Task 9）。
- Produces：
  - `meleeDamageFor(held: ItemStack | null): number`（＝ `toolDamage(held?.item ?? null) + sharpnessBonus(held)`）
  - `toolSpeed` 對「工具種類正確」的近戰／工具加 `efficiencyBonus(held)`。
  - `damageStack(stack, amount, rng = Math.random)`。
  - `absorbArmorDamage(set, amount)` 以 `points + protectionLevels(set)`（上限 20）計減傷。

- [ ] **Step 1: 測試先行**（每項效果的正／負／無附魔案例，rng 注入）
- [ ] **Step 2: Run to fail**
- [ ] **Step 3: Implement**
- [ ] **Step 4: main 接線**：`attackMob(..., meleeDamageFor(slots[selected]), ...)`；wiring 釘子 `countOf('meleeDamageFor(') === 1`。
- [ ] **Step 5: Run focused tests + typecheck** → PASS。
- [ ] **Step 6: Commit**

```bash
git add src/player/interact.ts src/core/durability.ts src/core/armor.ts src/main.ts src/main.wiring.test.ts src/player/interact.test.ts src/core/durability.test.ts src/core/armor.test.ts
git commit -m "feat(b17): 五種附魔效果（速度／傷害／減傷／耐久／幸運）"
```

---

### Task 11: 附魔台方塊、物品、貼圖、配方、音效

**Files:**
- Modify: `src/world/blocks.ts`（`BLOCK.ENCHANTING_TABLE = 49`、`T.ENCHANTING_TOP = 50`、`T.ENCHANTING_SIDE = 51`、`TILE_COUNT = 52`、`DEFS[49]`、`PLACEABLE`）
- Modify: `src/core/items.ts`（`ItemId` ＋ `ITEM_IDS` ＋ `BLOCK_PAIRS`；說明註解）
- Modify: `src/render/textures.ts`（畫兩個 tile：暗紫底＋金色角飾；top 中央有發光符文點）
- Modify: `src/core/recipes.ts`（新配方 `enchanting_table`：`[[null,'gold_ingot',null],['diamond','stone','diamond'],['stone','stone','stone']]`）
- Modify: `src/audio/sounds.ts`（`GROUP_BY_BLOCK[49] = 'stone'`）
- Modify: `src/ui/menus.ts`（暫停選單操作提示補一句「經驗與附魔」——只加文字，Task 13 若一併處理可略過此檔）
- Test: `src/world/blocks.test.ts`、`src/core/items.test.ts`、`src/render/textures.test.ts`、`src/core/recipes.test.ts`、`src/audio/sounds.test.ts`、`src/ui/ui.test.ts`（若動 menus）

**Interfaces:**
- Consumes: 無（Task 8 的 id 不衝突）。
- Produces：`BLOCK.ENCHANTING_TABLE`、`item 'enchanting_table'`、配方 70、tile 50/51。

- [ ] **Step 1: 測試先行**（把固定的表更新成期望值，先紅後綠）
- blocks.test.ts：hardness `49 → 5`、requiredTool `{pickaxe,0}`、fastTool `'pickaxe'`、blastResistance `1200`、append pin（49 是最大 id）、tile pin（`TILE_COUNT === 52`、`T.ENCHANTING_TOP !== T.TORCH` 等）。
- items.test.ts：`TOTAL_ITEM_COUNT === 116`、`ALL_ITEMS` 補 `enchanting_table`、block↔item 雙射。
- recipes.test.ts：總數 70、id 清單補 `enchanting_table`、配方形狀與結果（`{item:'enchanting_table',count:1}`）。
- textures.test.ts：兩個新 tile 都有畫（非 magenta；迴圈自動涵蓋，確認 `TILE_COUNT`）。
- sounds.test.ts：`GROUP_BY_BLOCK[BLOCK.ENCHANTING_TABLE] === 'stone'`、key 數＝BLOCK key 數。
- [ ] **Step 2: Run to fail**
- [ ] **Step 3: Implement**（貼圖照 `put(tile, fn)` 既有畫法；石頭音效群組）
- [ ] **Step 4: Run focused tests + typecheck** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/world/blocks.ts src/world/blocks.test.ts src/core/items.ts src/core/items.test.ts src/render/textures.ts src/render/textures.test.ts src/core/recipes.ts src/core/recipes.test.ts src/audio/sounds.ts src/audio/sounds.test.ts src/ui/menus.ts src/ui/ui.test.ts
git commit -m "feat(b17): 附魔台方塊／物品／貼圖／配方（id 49、tile 50-51、配方 70）"
```

---

### Task 12: 附魔面板與主線接線＋兩個新進度

**Files:**
- Create: `src/ui/enchanting.ts`、`src/ui/enchanting.test.ts`
- Modify: `src/ui/ui.css`（`.ui-enchant-*` 面板樣式，照 furnace panel 命名）
- Modify: `src/main.ts`（GameState、setState、右鍵分派、offers 狀態、`openEnchantingAt`、`__wecraft.enchants()`）
- Modify: `src/core/advancements.ts`、`src/core/advancements.test.ts`
- Modify: `src/main.wiring.test.ts`、`src/ui/ui.test.ts`

**Interfaces:**
- Consumes: Task 8 全部、Task 9 `ench`、Task 10 效果、Task 11 方塊、Task 6 `setExperience`。
- Produces：
  - `export interface EnchantView { stack: ItemStack | null; offers: EnchantOffer[]; level: number; free: boolean; message: string | null }`
  - `export interface EnchantingUI { open(view: EnchantView): void; close(): void; dispose(): void }`
  - `export function createEnchanting(root: HTMLElement, opts: { onChoose(index: number): void; onClose(): void }): EnchantingUI`
  - advancements：新 id `enchanter`、`experienced`；`AdvancementEvent` 加 `{ type: 'enchanted'; mode }` 與 `{ type: 'level'; level: number; mode }`。

- [ ] **Step 1: 進度測試先行**

`advancements.test.ts`：長度釘子 20 → 22；TRIGGERS 表加 `{ type:'enchanted', mode:'survival' } → enchanter`、`{ type:'level', level:9 } → []`、`{ type:'level', level:10 } → experienced`；creative 全抑制；重複不再解鎖。

- [ ] **Step 2: UI 測試先行**（`ui/enchanting.test.ts`，比照 `ui/furnace.test.ts`）

案例：
- `renders the held item, level and one button per offer` — 3 offers → `.ui-enchant-offer` 3 個、文字含 `Efficiency III` 與 `3 級`。
- `disables an offer the player cannot afford` — level 2＋cost 3 → button `disabled`。
- `renders the upgrade offer and the max-level message`。
- `renders 免費 in creative` — `free:true` → 文字含 `免費`、按鈕不 disabled。
- `fires onChoose with the button index and stays open`。
- `backdrop / Esc close and call onClose exactly once`（重開只留一個 handler）。

- [ ] **Step 3: 主線接線**

1. `const enchantUi = createEnchanting(uiRoot, {...})`；`let enchantOffers: EnchantOffer[] = []`。
2. `function enchantView(): EnchantView`：stack＝`slots[selected]`；offers＝（stack 且相容）`rollEnchantOffers(stack, Math.random)`；`free = currentMode === 'creative'`；message 三態（無物品／不能附魔／已達上限）。
3. `function openEnchantingAt(x,y,z): void` → `setState('enchanting')`＋`document.exitPointerLock?.()`。
4. `setState`：無條件關閉清單加 `enchantUi.close()`；新分支 `'enchanting'` → `const view = enchantView(); enchantOffers = view.offers; enchantUi.open(view);`（**只擲一次**選項）；`onClose` → `setState('playing')`＋`relockCanvas()`。
5. `onChoose(index)`：`const offer = enchantOffers[index]`；無效 → return；stack 驗證（仍可附魔、`applyEnchant` 後仍合規）；`cost = free ? 0 : offer.cost`；`currentMode==='survival'` 且 `cost > experience.level` → return；扣等級（`spendLevels`）→ `inventory.setSlot(selected, applyEnchant(stack, offer.enchant))` → `hud.setHotbar` → `applyAdvancement({ type:'enchanted', mode: currentMode })` → 重算 offers／重繪面板。
6. 右鍵分派：在 `BLOCK.BED` 分支之後、`TNT` 分支之前插入 `else if (hit && hitBlock === BLOCK.ENCHANTING_TABLE) { openEnchantingAt(...) }`（兩種模式都可開）。
7. `setExperience`：等級上升時 `applyAdvancement({ type:'level', level: experience.level, mode: currentMode })`（Task 6 預留的位置補上）。
8. `__wecraft.enchants()`：回傳 `slots[selected]?.ench` 的複本或 null。

- [ ] **Step 4: 接線釘子**

- `blockAfter('if (wantPlace) {')` 的分派順序：`BLOCK.BED` 位置 < `BLOCK.ENCHANTING_TABLE` 位置 < `heldIsBucket()` 位置；
- `countOf('openEnchantingAt(') === 1`；`countOf('enchantUi.open(') === 1`；`enchantUi.close()` 在 setState 關閉清單；
- `GameState` 含 `'enchanting'`；
- `functionBody('onChoose')`（或匿名回呼所在的 `createEnchanting` 呼叫）含 `spendLevels`、`applyEnchant`、`applyAdvancement`；
- debug 介面含 `enchants`。

- [ ] **Step 5: Run focused tests + typecheck**

Run: `npx vitest run src/ui/enchanting.test.ts src/core/advancements.test.ts src/main.wiring.test.ts src/ui/ui.test.ts && npm run typecheck` → PASS。

- [ ] **Step 6: Commit**

```bash
git add src/ui/enchanting.ts src/ui/enchanting.test.ts src/ui/ui.css src/main.ts src/main.wiring.test.ts src/core/advancements.ts src/core/advancements.test.ts src/ui/ui.test.ts
git commit -m "feat(b17): 附魔台面板與接線、附魔師／經驗老到進度"
```

---

### Task 13: 版本、文件與發布說明

**Files:**
- Modify: `game.json`（`version: "0.20.0"`；`instructions` 追加經驗與附魔的操作說明，長度 ≤ 2000）
- Modify: `package.json`（`version: "0.20.0"`）
- Modify: `README.md`（Description、遊戲特色、與原版的差異、專案狀態＋B17 條目；測試數字最後填）
- Create: `docs/releases/v0.20.0.md`（新增／修正／存檔格式與相容性提示／已知問題簡化／驗證；數字先留 `TODO`，Task 14 後回填）
- Modify: `docs/superpowers/specs/2026-10-18-wecraft-parity-design.md`（§B17 結案段、§5 第 2 點、§6 清單）
- Modify: `src/ui/menus.ts` 操作提示（若 Task 11 未做）

- [ ] **Step 1: 版本 bump＋README＋release notes＋母規格**
- [ ] **Step 2: `npx vitest run src/ui/ui.test.ts`（menus 釘子）＋`npm run typecheck`**
- [ ] **Step 3: Commit**

```bash
git add game.json package.json README.md docs/releases/v0.20.0.md docs/superpowers/specs/2026-10-18-wecraft-parity-design.md src/ui/menus.ts src/ui/ui.test.ts
git commit -m "docs(b17): 0.20.0 版本、README、發布說明與母規格同步"
```

---

### Task 14: 批次驗證（控制器執行）

**Files:** 無程式變更（驗證＋回填文件）。

- [ ] **Step 1:** `npm run typecheck`、`npm test`、`npm run lint`、`npm run build`、`npm run test:perf` 全過（記錄檔案數／測試數／bundle 大小）。
- [ ] **Step 2:** pinned 工具 pack＋validate（解壓 `.playroom/tools/playroom-game-tools-1.2.0.zip` 到 repo 外，`node pack-game.mjs dist <repo外>/game.zip`、`node validate-game.mjs …`）→ `Packed wecraft v0.20.0`／`Valid: wecraft v0.20.0`；記錄 ZIP bytes 與 SHA-256。
- [ ] **Step 3:** 真瀏覽器 smoke（`xvfb-run` ＋平台 checkout 的 `playwright-core`，靜態伺服 `dist/`，probe 放 `/tmp/opencode/`）：
  - 標題 → 單人（survival）→ `?xp=500` 下 HUD 條與等級正確、F3 `Xp:` 行；
  - 挖煤礦 → 球生成、吸收、等級上升（`__wecraft.xpState()`）；
  - 切創造 → 經驗條隱藏、經驗保留；取得附魔台＋鑽鎬 → 放置 → 右鍵開面板 → 附魔免費成功（`__wecraft.enchants()`）→ 面板關閉後 pointer lock 回來；
  - 0 console/page error；未涵蓋項列未驗證。
- [ ] **Step 4:** 回填 `docs/releases/v0.20.0.md` 的驗證數字；若驗證期間有修正 → 提高版本？**不**，本批未發布、直接補 commit（修正屬於同一未發布版本）。
- [ ] **Step 5:** 誠實回報：程式完成／ZIP 驗證／Release（未執行）／平台上架（未執行）。

---

## Self-Review

- **Spec coverage**：§4→T1、§5→T2/T3/T6、§6→T4/T6、§7→T8、§8→T10、§9→T11/T12、§10→T7/T9、§11→T5/T6、§12→T14、§13→T13。
- **型別一致性**：`Experience`、`XpOrb`、`Enchantment`、`EnchantOffer`、`EnchantView` 在產生任務與消費任務間名稱一致；`awardXpAt`／`setExperience`／`giveStack` 只在 main 內部。
- **Review Focus**：五條各自有指名的測試任務（1/7/9、1/2/6、9/10、12、6/7）。
- **已知風險**：Task 9 面積最大（跨 10+ 檔案）——以整合測試＋grep 稽核＋任務審查把關；Task 6 的 `awardXpAt` 呼叫點計數若因迴圈實作而不同，以註解說明的實際數字為準（計畫值 6）。
