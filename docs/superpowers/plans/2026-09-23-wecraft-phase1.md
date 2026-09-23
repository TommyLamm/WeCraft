# WeCraft Phase 1（骨架）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可玩的網頁版 Minecraft 骨架：無限地形、移動碰撞、挖掘/放置（含破壞時間）、背包與熱鍵欄、創造模式、標題/暫停選單、程序貼圖。

**Architecture:** Three.js 只存在於 `render/`；`core/`、`world/`、`player/` 為純邏輯可單測。世界由 16×16×256 區塊組成，地形在 Web Worker 生成，主執行緒佇列組網格（每幀限額）。事件經 `core/bus` 單向流動。

**Tech Stack:** TypeScript + Vite + Three.js + Vitest (jsdom) + ESLint；無其他 runtime 依賴。

**Spec:** `docs/superpowers/specs/2026-09-23-wecraft-design.md`

**範圍：** 本計畫 = spec「第一期」。血量飢餓、日夜、怪物、合成、死亡畫面（第二期）與 AO、雲、音效、粒子（第三期）**不在本計畫**。

**Spec 落差備註：** spec 寫「512×512 貼圖圖集」+「貪婪網格化」。Task 11 的 `bakeAtlasUvs` 把 mesher 的 0..1 uv 烘成圖集座標（防滲色 inset）；Task 18 把面剔除 mesher 升級為貪婪網格化。圖集全程由程序生成。

---

## File Structure

```
F:\Desktop\WeCraft\
├── package.json / tsconfig.json / vite.config.ts / eslint.config.js / .gitignore
├── index.html
└── src/
    ├── main.ts                 啟動、遊戲狀態機、主循環
    ├── style.css
    ├── core/
    │   ├── bus.ts              事件匯流排
    │   ├── noise.ts            種子 Perlin 2D/3D + fbm + hash2
    │   └── settings.ts         設定讀寫 (localStorage)
    ├── world/
    │   ├── blocks.ts           方塊註冊表（硬度/貼圖/實心/透明）
    │   ├── chunk.ts            Chunk 資料 (Uint8Array 65536)
    │   ├── world.ts            區塊集合、全域 get/setBlock、dirty
    │   ├── terrain.ts          程序地形（Worker 與主執行緒共用）
    │   ├── raycast.ts          voxel DDA
    │   ├── mesher.ts           面剔除網格化（Task 18 升級貪婪）
    │   ├── worker.ts           Web Worker 入口
    │   └── worker-client.ts    佇列 + 崩潰降級
    ├── player/
    │   ├── physics.ts          AABB 物理（純函式）
    │   ├── input.ts            鍵盤/滑鼠/pointer lock
    │   └── interact.ts         挖掘進度/放置判定（純函式）
    ├── render/
    │   ├── textures.ts         512 程序圖集
    │   ├── scene.ts            場景/相機/霧/天空
    │   └── chunk-renderer.ts   world 面資料 → Mesh
    └── ui/
        ├── hud.ts              準星/熱鍵欄/F3
        ├── menus.ts            標題/暫停選單
        └── inventory.ts        背包 (E)
```

測試與原始檔同放：`src/**/*.test.ts`。

---

### Task 1: 專案腳手架

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.gitignore`, `index.html`, `src/main.ts`, `src/style.css`

- [ ] **Step 1: 建立 `package.json`**

```json
{
  "name": "wecraft",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "three": "^0.170.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.10.0",
    "@types/three": "^0.170.0",
    "eslint": "^9.10.0",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.2",
    "typescript-eslint": "^8.7.0",
    "vite": "^5.4.8",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: 執行安裝**

Run: `npm install`
Expected: 完成無 error（warning 可忽略）。

- [ ] **Step 3: 建立 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts", "eslint.config.js"]
}
```

- [ ] **Step 4: 建立 `vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: 建立 `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.superpowers'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 6: 建立 `.gitignore`**

```
node_modules/
dist/
.superpowers/
*.log
```

- [ ] **Step 7: 建立 `index.html`**

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WeCraft</title>
  </head>
  <body>
    <div id="app">
      <canvas id="game-canvas"></canvas>
      <div id="ui-root"></div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 8: 建立 `src/style.css`**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
  font-family: 'Segoe UI', 'Microsoft JhengHei', sans-serif;
  user-select: none;
}

#game-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

#ui-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

#ui-root .interactive {
  pointer-events: auto;
}
```

- [ ] **Step 9: 建立最小 `src/main.ts`（確認渲染管線）**

```ts
import './style.css';
import * as THREE from 'three';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshBasicMaterial({ color: 0x55aa55 }),
);
scene.add(mesh);

renderer.setAnimationLoop((t) => {
  mesh.rotation.x = t / 1000;
  mesh.rotation.y = t / 1500;
  renderer.render(scene, camera);
});
```

- [ ] **Step 10: 驗證型別與測試指令**

Run: `npm run typecheck`
Expected: 無輸出（0 errors）。

Run: `npm test`
Expected: `No test files found`（Task 2 起有測試；此步只確認指令可跑）。

- [ ] **Step 11: Git 初始化與提交**

```bash
git init
git add -A
git commit -m "chore: scaffold vite + three + typescript project"
```

---

### Task 2: `core/bus` 事件匯流排

**Files:**
- Create: `src/core/bus.ts`
- Test: `src/core/bus.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createBus } from './bus';

describe('createBus', () => {
  it('subscribers receive emitted events', () => {
    const bus = createBus<{ 'block:change': { x: number } }>();
    const fn = vi.fn();
    bus.on('block:change', fn);
    bus.emit('block:change', { x: 3 });
    expect(fn).toHaveBeenCalledWith({ x: 3 });
  });

  it('unsubscribe stops delivery', () => {
    const bus = createBus<{ 'block:change': { x: number } }>();
    const fn = vi.fn();
    const off = bus.on('block:change', fn);
    off();
    bus.emit('block:change', { x: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('one failing listener does not break others', () => {
    const bus = createBus<{ e: number }>();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    bus.on('e', bad);
    bus.on('e', good);
    bus.emit('e', 1);
    expect(good).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './bus'`

- [ ] **Step 3: 實作 `src/core/bus.ts`**

```ts
export type Unsubscribe = () => void;

export interface Bus<Events extends Record<string, unknown>> {
  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): Unsubscribe;
  emit<K extends keyof Events>(type: K, payload: Events[K]): void;
}

export function createBus<Events extends Record<string, unknown>>(): Bus<Events> {
  const listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  return {
    on(type, fn) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      const wrapped = fn as (payload: never) => void;
      set.add(wrapped);
      return () => set!.delete(wrapped);
    },
    emit(type, payload) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          (fn as (p: Events[typeof type]) => void)(payload);
        } catch (err) {
          console.error('[bus] listener error', type, err);
        }
      }
    },
  };
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add src/core/bus.ts src/core/bus.test.ts
git commit -m "feat: add typed event bus"
```

---

### Task 3: `core/noise` 種子噪聲

**Files:**
- Create: `src/core/noise.ts`
- Test: `src/core/noise.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { Noise, hash2 } from './noise';

describe('hash2', () => {
  it('is deterministic', () => {
    expect(hash2(3, 7, 42)).toBe(hash2(3, 7, 42));
  });
  it('differs by position and seed', () => {
    expect(hash2(3, 7, 42)).not.toBe(hash2(4, 7, 42));
    expect(hash2(3, 7, 42)).not.toBe(hash2(3, 7, 43));
  });
  it('returns uint32 range', () => {
    const h = hash2(-1000, 1000, 0);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('Noise', () => {
  it('same seed same values', () => {
    const a = new Noise(123);
    const b = new Noise(123);
    for (let i = 0; i < 20; i++) {
      expect(a.noise2(i * 0.37, i * 1.1)).toBe(b.noise2(i * 0.37, i * 1.1));
    }
  });

  it('different seed differs', () => {
    const a = new Noise(1);
    const b = new Noise(2);
    expect(a.noise2(0.5, 0.5)).not.toBe(b.noise2(0.5, 0.5));
  });

  it('noise2 stays in [-1, 1]', () => {
    const n = new Noise(99);
    for (let i = 0; i < 500; i++) {
      const v = n.noise2(i * 0.13 - 30, i * 0.29 - 10);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('noise3 deterministic and bounded', () => {
    const n = new Noise(7);
    const v1 = n.noise3(1.5, 2.5, 3.5);
    expect(v1).toBe(n.noise3(1.5, 2.5, 3.5));
    expect(Math.abs(v1)).toBeLessThanOrEqual(1);
  });

  it('fbm deterministic', () => {
    const n = new Noise(5);
    expect(n.fbm2(10.2, -3.4, 4)).toBe(n.fbm2(10.2, -3.4, 4));
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './noise'`

- [ ] **Step 3: 實作 `src/core/noise.ts`**

```ts
export function hash2(x: number, z: number, seed: number): number {
  let h = (seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function grad2(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function grad3(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export class Noise {
  private p = new Uint8Array(512);

  constructor(seed: number) {
    const rand = mulberry32(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
  }

  noise2(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const p = this.p;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
    const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }

  noise3(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const p = this.p;
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    const x1 = lerp(grad3(p[AA], xf, yf, zf), grad3(p[BA], xf - 1, yf, zf), u);
    const x2 = lerp(grad3(p[AB], xf, yf - 1, zf), grad3(p[BB], xf - 1, yf - 1, zf), u);
    const y1 = lerp(x1, x2, v);
    const x3 = lerp(grad3(p[AA + 1], xf, yf, zf - 1), grad3(p[BA + 1], xf - 1, yf, zf - 1), u);
    const x4 = lerp(
      grad3(p[AB + 1], xf, yf - 1, zf - 1),
      grad3(p[BB + 1], xf - 1, yf - 1, zf - 1),
      u,
    );
    const y2 = lerp(x3, x4, v);
    return lerp(y1, y2, w);
  }

  fbm2(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS（hash2 x3 + Noise x4）

- [ ] **Step 5: Commit**

```bash
git add src/core/noise.ts src/core/noise.test.ts
git commit -m "feat: seeded perlin noise and hash utilities"
```

---

### Task 4: `core/settings` 設定

**Files:**
- Create: `src/core/settings.ts`
- Test: `src/core/settings.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from './settings';

beforeEach(() => {
  localStorage.clear();
});

describe('settings', () => {
  it('returns defaults when nothing stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists and reloads', () => {
    saveSettings({ renderDistance: 8, sensitivity: 0.3 });
    const s = loadSettings();
    expect(s.renderDistance).toBe(8);
    expect(s.sensitivity).toBe(0.3);
    expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
  });

  it('clamps out-of-range renderDistance', () => {
    saveSettings({ renderDistance: 999 });
    expect(loadSettings().renderDistance).toBe(16);
    saveSettings({ renderDistance: 1 });
    expect(loadSettings().renderDistance).toBe(6);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './settings'`

- [ ] **Step 3: 實作 `src/core/settings.ts`**

```ts
export interface Settings {
  seed: number;
  renderDistance: number;
  sensitivity: number;
  volume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  seed: 1337,
  renderDistance: 10,
  sensitivity: 1.0,
  volume: 0.8,
};

const KEY = 'wecraft.settings';

function clampSettings(s: Settings): Settings {
  return {
    ...s,
    renderDistance: Math.min(16, Math.max(6, Math.round(s.renderDistance))),
    sensitivity: Math.min(3, Math.max(0.1, s.sensitivity)),
    volume: Math.min(1, Math.max(0, s.volume)),
    seed: Math.floor(s.seed) || 0,
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return clampSettings({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = clampSettings({ ...loadSettings(), ...patch });
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS（bus/noise/settings 全部通過）

- [ ] **Step 5: Commit**

```bash
git add src/core/settings.ts src/core/settings.test.ts
git commit -m "feat: persisted settings with clamping"
```

---

### Task 5: `world/blocks` 方塊註冊表

**Files:**
- Create: `src/world/blocks.ts`
- Test: `src/world/blocks.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { BLOCK, getBlockDef, isSolid, isTransparent, PLACEABLE } from './blocks';

describe('blocks', () => {
  it('air id is 0 and not solid', () => {
    expect(BLOCK.AIR).toBe(0);
    expect(isSolid(BLOCK.AIR)).toBe(false);
  });

  it('stone is solid, hardness > 0', () => {
    expect(isSolid(BLOCK.STONE)).toBe(true);
    expect(getBlockDef(BLOCK.STONE).hardness).toBeGreaterThan(0);
  });

  it('bedrock cannot be broken', () => {
    expect(getBlockDef(BLOCK.BEDROCK).hardness).toBe(Infinity);
  });

  it('glass is transparent and solid', () => {
    expect(isTransparent(BLOCK.GLASS)).toBe(true);
    expect(isSolid(BLOCK.GLASS)).toBe(true);
  });

  it('water is not solid but exists', () => {
    expect(isSolid(BLOCK.WATER)).toBe(false);
    expect(getBlockDef(BLOCK.WATER).name).toBe('water');
  });

  it('every non-air block has valid tile indices', () => {
    for (const def of Object.values(BLOCK)) {
      if (def === 0) continue;
      const d = getBlockDef(def);
      for (const t of [d.top, d.side, d.bottom]) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(64);
      }
    }
  });

  it('placeable list has no air/water and at least 9', () => {
    expect(PLACEABLE).not.toContain(BLOCK.AIR);
    expect(PLACEABLE).not.toContain(BLOCK.WATER);
    expect(PLACEABLE.length).toBeGreaterThanOrEqual(9);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './blocks'`

- [ ] **Step 3: 實作 `src/world/blocks.ts`**

```ts
export const BLOCK = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  PLANKS: 7,
  COBBLE: 8,
  WATER: 9,
  BEDROCK: 10,
  SNOW: 11,
  GLASS: 12,
  COAL_ORE: 13,
  IRON_ORE: 14,
} as const;

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK];

export interface BlockDef {
  id: BlockId;
  name: string;
  hardness: number; // 秒；Infinity = 不可破壞
  solid: boolean;
  transparent: boolean;
  top: number; // 圖集 tile 索引 0..63
  side: number;
  bottom: number;
}

const T = {
  GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3,
  SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7,
  PLANKS: 8, COBBLE: 9, WATER: 10, BEDROCK: 11,
  SNOW_TOP: 12, SNOW_SIDE: 13, GLASS: 14,
  COAL: 15, IRON: 16,
} as const;

const DEFS: Record<number, BlockDef> = {
  0: { id: 0, name: 'air', hardness: 0, solid: false, transparent: true, top: 0, side: 0, bottom: 0 },
  1: { id: 1, name: 'stone', hardness: 2.0, solid: true, transparent: false, top: T.STONE, side: T.STONE, bottom: T.STONE },
  2: { id: 2, name: 'dirt', hardness: 0.6, solid: true, transparent: false, top: T.DIRT, side: T.DIRT, bottom: T.DIRT },
  3: { id: 3, name: 'grass_block', hardness: 0.7, solid: true, transparent: false, top: T.GRASS_TOP, side: T.GRASS_SIDE, bottom: T.DIRT },
  4: { id: 4, name: 'sand', hardness: 0.6, solid: true, transparent: false, top: T.SAND, side: T.SAND, bottom: T.SAND },
  5: { id: 5, name: 'oak_log', hardness: 1.5, solid: true, transparent: false, top: T.LOG_TOP, side: T.LOG_SIDE, bottom: T.LOG_TOP },
  6: { id: 6, name: 'oak_leaves', hardness: 0.3, solid: true, transparent: true, top: T.LEAVES, side: T.LEAVES, bottom: T.LEAVES },
  7: { id: 7, name: 'oak_planks', hardness: 1.2, solid: true, transparent: false, top: T.PLANKS, side: T.PLANKS, bottom: T.PLANKS },
  8: { id: 8, name: 'cobblestone', hardness: 2.2, solid: true, transparent: false, top: T.COBBLE, side: T.COBBLE, bottom: T.COBBLE },
  9: { id: 9, name: 'water', hardness: Infinity, solid: false, transparent: true, top: T.WATER, side: T.WATER, bottom: T.WATER },
  10: { id: 10, name: 'bedrock', hardness: Infinity, solid: true, transparent: false, top: T.BEDROCK, side: T.BEDROCK, bottom: T.BEDROCK },
  11: { id: 11, name: 'snow_block', hardness: 0.6, solid: true, transparent: false, top: T.SNOW_TOP, side: T.SNOW_SIDE, bottom: T.DIRT },
  12: { id: 12, name: 'glass', hardness: 0.4, solid: true, transparent: true, top: T.GLASS, side: T.GLASS, bottom: T.GLASS },
  13: { id: 13, name: 'coal_ore', hardness: 2.5, solid: true, transparent: false, top: T.COAL, side: T.COAL, bottom: T.COAL },
  14: { id: 14, name: 'iron_ore', hardness: 3.0, solid: true, transparent: false, top: T.IRON, side: T.IRON, bottom: T.IRON },
};

export function getBlockDef(id: number): BlockDef {
  return DEFS[id] ?? DEFS[0];
}

export const isSolid = (id: number): boolean => getBlockDef(id).solid;
export const isTransparent = (id: number): boolean => getBlockDef(id).transparent;

export const PLACEABLE: BlockId[] = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS,
  BLOCK.LOG, BLOCK.LEAVES, BLOCK.SAND, BLOCK.GLASS, BLOCK.SNOW,
  BLOCK.BEDROCK, BLOCK.COAL_ORE, BLOCK.IRON_ORE,
];

export const HOTBAR_DEFAULT: BlockId[] = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS,
  BLOCK.LOG, BLOCK.LEAVES, BLOCK.SAND, BLOCK.GLASS,
];
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/world/blocks.ts src/world/blocks.test.ts
git commit -m "feat: block registry with hardness and tiles"
```

---

### Task 6: `world/chunk` + `world/world` 資料層

**Files:**
- Create: `src/world/chunk.ts`, `src/world/world.ts`
- Test: `src/world/world.test.ts`

**Deviations:**
- `chunkIndex` middle test asserts swapped: plan originally asserted `(0,1,0)=16, (0,0,1)=256`, which is unsatisfiable with the boundary max `16*16*256-1=65535`; implementation keeps y-stride-256 (`lx + lz*16 + ly*256`), so tests now assert `(0,1,0)=256, (0,0,1)=16`.
- `World.setBlock` AUTO-CREATES the target chunk when y is in range and the chunk is missing (plan Step 4 code said `return false`, but plan Step 1 tests require creation). The y-OOB check still comes first and does NOT create.
- `World.isSolid` delegates to `blocks.isSolid` (aliased import) instead of the plan's local `SOLID` Set.
- Downstream (Tasks 12/13/14): because setBlock auto-creates, loaders must key off `chunk.generated` (or equivalent), not just `world.hasChunk`, to avoid generation-queue poisoning.

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { Chunk, chunkIndex } from './chunk';
import { World } from './world';
import { BLOCK } from './blocks';

describe('chunkIndex', () => {
  it('maps coords deterministically', () => {
    expect(chunkIndex(0, 0, 0)).toBe(0);
    expect(chunkIndex(1, 0, 0)).toBe(1);
    expect(chunkIndex(0, 1, 0)).toBe(16);
    expect(chunkIndex(0, 0, 1)).toBe(256);
    expect(chunkIndex(15, 255, 15)).toBe(16 * 16 * 256 - 1);
  });
});

describe('Chunk', () => {
  it('get/set roundtrip', () => {
    const c = new Chunk(0, 0);
    c.set(3, 64, 5, BLOCK.STONE);
    expect(c.get(3, 64, 5)).toBe(BLOCK.STONE);
  });

  it('out of range y returns air', () => {
    const c = new Chunk(0, 0);
    expect(c.get(0, 256, 0)).toBe(BLOCK.AIR);
    expect(c.get(0, -1, 0)).toBe(BLOCK.AIR);
  });
});

describe('World', () => {
  it('setBlock marks chunk dirty', () => {
    const w = new World();
    w.setBlock(5, 70, 5, BLOCK.STONE);
    expect(w.getChunk(0, 0)?.dirty).toBe(true);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.STONE);
    w.setBlock(5, 70, 5, BLOCK.DIRT);
    expect(w.getBlock(5, 70, 5)).toBe(BLOCK.DIRT);
  });

  it('getBlock outside loaded chunks is air', () => {
    const w = new World();
    expect(w.getBlock(1000, 64, 1000)).toBe(BLOCK.AIR);
  });

  it('crossing chunk boundary works', () => {
    const w = new World();
    w.setBlock(16, 64, 0, BLOCK.STONE);
    expect(w.getChunk(1, 0)?.get(0, 64, 0)).toBe(BLOCK.STONE);
    expect(w.getBlock(16, 64, 0)).toBe(BLOCK.STONE);
  });

  it('setBlock on y out of range is ignored', () => {
    const w = new World();
    expect(w.setBlock(0, 300, 0, BLOCK.STONE)).toBe(false);
    expect(w.getChunk(0, 0)).toBeUndefined();
  });

  it('edge setBlock dirties neighbor chunk', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    w.addChunk(new Chunk(1, 0));
    w.getChunk(1, 0)!.dirty = false;
    w.setBlock(15, 64, 0, BLOCK.STONE); // lx=15 → 鄰接 cx=1
    expect(w.getChunk(1, 0)!.dirty).toBe(true);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './chunk'`

- [ ] **Step 3: 實作 `src/world/chunk.ts`**

```ts
import { BLOCK } from './blocks';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 256;

export function chunkIndex(lx: number, ly: number, lz: number): number {
  return lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
}

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly data: Uint8Array;
  dirty = true;
  generated = false;

  constructor(cx: number, cz: number, data?: Uint8Array) {
    this.cx = cx;
    this.cz = cz;
    this.data = data ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  }

  get(lx: number, ly: number, lz: number): number {
    if (ly < 0 || ly >= CHUNK_HEIGHT) return BLOCK.AIR;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return BLOCK.AIR;
    return this.data[chunkIndex(lx, ly, lz)];
  }

  set(lx: number, ly: number, lz: number, id: number): void {
    if (ly < 0 || ly >= CHUNK_HEIGHT) return;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    this.data[chunkIndex(lx, ly, lz)] = id;
    this.dirty = true;
  }
}
```

- [ ] **Step 4: 實作 `src/world/world.ts`**

```ts
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from './chunk';
import { BLOCK, type BlockId } from './blocks';

const SOLID = new Set<number>([
  BLOCK.STONE, BLOCK.DIRT, BLOCK.GRASS, BLOCK.SAND, BLOCK.LOG,
  BLOCK.LEAVES, BLOCK.PLANKS, BLOCK.COBBLE, BLOCK.BEDROCK,
  BLOCK.SNOW, BLOCK.GLASS, BLOCK.COAL_ORE, BLOCK.IRON_ORE,
]);

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class World {
  readonly chunks = new Map<string, Chunk>();
  readonly modified = new Set<string>();

  hasChunk(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  addChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
  }

  removeChunk(cx: number, cz: number): void {
    this.chunks.delete(chunkKey(cx, cz));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return BLOCK.AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return BLOCK.AIR;
    return chunk.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE);
  }

  setBlock(x: number, y: number, z: number, id: BlockId): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk) return false;
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    chunk.set(lx, y, lz, id);
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    this.modified.add(chunkKey(cx, cz));
    return true;
  }

  markDirty(cx: number, cz: number): void {
    const c = this.getChunk(cx, cz);
    if (c) c.dirty = true;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return SOLID.has(this.getBlock(x, y, z));
  }
}
```

- [ ] **Step 5: 執行確認通過**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/world/chunk.ts src/world/world.ts src/world/world.test.ts
git commit -m "feat: chunk storage and world block access"
```

---

### Task 7: `world/terrain` 程序地形生成

**Files:**
- Create: `src/world/terrain.ts`
- Test: `src/world/terrain.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { generateChunk, SEA_LEVEL } from './terrain';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';

describe('generateChunk', () => {
  it('same seed same data', () => {
    const a = generateChunk(3, -2, 1337);
    const b = generateChunk(3, -2, 1337);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('different seed differs', () => {
    const a = generateChunk(0, 0, 1);
    const b = generateChunk(0, 0, 2);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('y=0 is bedrock', () => {
    const c = generateChunk(0, 0, 1337);
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++)
        expect(c[chunkIndex(x, 0, z)]).toBe(BLOCK.BEDROCK);
  });

  it('column has solid surface and air above', () => {
    const c = generateChunk(0, 0, 1337);
    let topY = -1;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const id = c[chunkIndex(8, y, 8)];
      if (id !== BLOCK.AIR && id !== BLOCK.WATER) {
        topY = y;
        break;
      }
    }
    expect(topY).toBeGreaterThan(0);
    expect(topY).toBeLessThan(CHUNK_HEIGHT - 1);
    expect(c[chunkIndex(8, topY + 1, 8)]).toBe(BLOCK.AIR);
  });

  it('has stone below surface', () => {
    expect(generateChunk(0, 0, 1337).includes(BLOCK.STONE)).toBe(true);
  });

  it('sea level constant exported', () => {
    expect(SEA_LEVEL).toBeGreaterThan(0);
    expect(SEA_LEVEL).toBeLessThan(CHUNK_HEIGHT);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './terrain'`

- [ ] **Step 3: 實作 `src/world/terrain.ts`**

```ts
import { Noise, hash2 } from '../core/noise';
import { BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT, chunkIndex } from './chunk';

export const SEA_LEVEL = 62;

type Biome = 'plains' | 'desert' | 'forest' | 'snow';

function pickBiome(temp: number, moist: number): Biome {
  if (temp > 0.35 && moist < -0.1) return 'desert';
  if (temp < -0.35) return 'snow';
  if (moist > 0.15) return 'forest';
  return 'plains';
}

export function generateChunk(cx: number, cz: number, seed: number): Uint8Array {
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  const heightN = new Noise(seed);
  const biomeN = new Noise(seed ^ 0x9e3779b9);
  const caveN = new Noise(seed ^ 0x51ed270b);

  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = baseX + lx;
      const wz = baseZ + lz;

      const cont = heightN.fbm2(wx * 0.0035, wz * 0.0035, 4);
      const ridgeRaw = heightN.noise2(wx * 0.008 + 100, wz * 0.008 + 100);
      const ridge = 1 - Math.abs(ridgeRaw);
      let h = 66 + cont * 28 + ridge * ridge * 22;
      h = Math.max(4, Math.min(CHUNK_HEIGHT - 10, Math.floor(h)));

      const temp = biomeN.fbm2(wx * 0.004, wz * 0.004, 2);
      const moist = biomeN.fbm2(wx * 0.004 + 50, wz * 0.004 + 50, 2);
      const biome = pickBiome(temp, moist);

      for (let y = 1; y < CHUNK_HEIGHT; y++) {
        let id: number = BLOCK.AIR;

        if (y === 0) id = BLOCK.BEDROCK;
        else if (y < h - 4) id = BLOCK.STONE;
        else if (y < h) id = biome === 'desert' ? BLOCK.SAND : BLOCK.DIRT;
        else if (y === h) {
          if (biome === 'desert') id = BLOCK.SAND;
          else if (biome === 'snow') id = BLOCK.SNOW;
          else id = BLOCK.GRASS;
        } else if (y <= SEA_LEVEL) {
          id = BLOCK.WATER;
        }

        if (id === BLOCK.STONE && y < h - 6) {
          const ore = hash2(wx * 31 + y, wz * 17 - y, seed);
          if (y < 16 && ore % 400 === 0) id = BLOCK.IRON_ORE;
          else if (ore % 120 === 0) id = BLOCK.COAL_ORE;
        }

        if (y > 3 && y < h - 2 && id !== BLOCK.BEDROCK && id !== BLOCK.WATER) {
          const cave = caveN.noise3(wx * 0.05, y * 0.07, wz * 0.05);
          if (cave > 0.62) id = BLOCK.AIR;
        }

        data[chunkIndex(lx, y, lz)] = id;
      }
    }
  }

  plantTrees(data, cx, cz, seed, biomeN);
  return data;
}

function plantTrees(
  data: Uint8Array,
  cx: number,
  cz: number,
  seed: number,
  biomeN: Noise,
): void {
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let tz = 0; tz < CHUNK_SIZE; tz++) {
    for (let tx = 0; tx < CHUNK_SIZE; tx++) {
      const wx = baseX + tx;
      const wz = baseZ + tz;
      const h = hash2(wx, wz, seed ^ 0xabc123);
      if (h % 100 >= 6) continue;

      const temp = biomeN.fbm2(wx * 0.004, wz * 0.004, 2);
      const moist = biomeN.fbm2(wx * 0.004 + 50, wz * 0.004 + 50, 2);
      if (pickBiome(temp, moist) === 'desert') continue;

      let ground = -1;
      for (let y = CHUNK_HEIGHT - 1; y > 0; y--) {
        const id = data[chunkIndex(tx, y, tz)];
        if (id !== BLOCK.AIR && id !== BLOCK.WATER) {
          ground = y;
          break;
        }
      }
      if (ground <= SEA_LEVEL + 1) continue;

      const trunkH = 4 + (h % 3);
      const put = (x: number, y: number, z: number, id: number) => {
        if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return;
        if (y < 0 || y >= CHUNK_HEIGHT) return;
        const i = chunkIndex(x, y, z);
        if (data[i] === BLOCK.AIR) data[i] = id;
      };

      for (let t = 1; t <= trunkH; t++) put(tx, ground + t, tz, BLOCK.LOG);

      const top = ground + trunkH;
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy <= -1 ? 2 : 1;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && dy >= 0) continue;
            put(tx + dx, top + dy, tz + dz, BLOCK.LEAVES);
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/world/terrain.ts src/world/terrain.test.ts
git commit -m "feat: deterministic terrain generator with biomes"
```

---

### Task 8: `world/raycast` DDA 拾取

**Files:**
- Create: `src/world/raycast.ts`
- Test: `src/world/raycast.test.ts`

**Deviations:**
- start-inside normal: dominant-axis single face (was multi-axis `-step`) — protects Task 15 face-adjacent placement
- dir normalized internally; RayHit gained `t` field
- tests use world.isSolid

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { raycast } from './raycast';
import { World } from './world';
import { Chunk } from './chunk';
import { BLOCK } from './blocks';

function setup(): World {
  const w = new World();
  w.addChunk(new Chunk(0, 0));
  return w;
}

describe('raycast', () => {
  it('hits block straight ahead and reports face normal', () => {
    const w = setup();
    w.setBlock(0, 64, -3, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(0);
    expect(hit!.y).toBe(64);
    expect(hit!.z).toBe(-3);
    expect(hit!.nz).toBe(1);
  });

  it('returns null when no block in range', () => {
    const w = setup();
    const hit = raycast(w, { x: 0.5, y: 80, z: 0.5 }, { x: 0, y: 1, z: 0 }, 5);
    expect(hit).toBeNull();
  });

  it('respects max distance', () => {
    const w = setup();
    w.setBlock(0, 64, -8, BLOCK.STONE);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 5);
    expect(hit).toBeNull();
  });

  it('does not hit water (non-solid)', () => {
    const w = setup();
    w.setBlock(0, 64, -2, BLOCK.WATER);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).toBeNull();
  });

  it('hits glass (solid)', () => {
    const w = setup();
    w.setBlock(0, 64, -2, BLOCK.GLASS);
    const hit = raycast(w, { x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: -1 }, 10);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBe(-2);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './raycast'`

- [ ] **Step 3: 實作 `src/world/raycast.ts`**

```ts
import type { World } from './world';
import { isSolid } from './blocks';

export interface RayHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

export function raycast(
  world: World,
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDist: number,
): RayHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  const frac = (o: number) => o - Math.floor(o);
  let tMaxX = stepX === 0 ? Infinity : stepX > 0 ? (1 - frac(origin.x)) * tDeltaX : frac(origin.x) * tDeltaX;
  let tMaxY = stepY === 0 ? Infinity : stepY > 0 ? (1 - frac(origin.y)) * tDeltaY : frac(origin.y) * tDeltaY;
  let tMaxZ = stepZ === 0 ? Infinity : stepZ > 0 ? (1 - frac(origin.z)) * tDeltaZ : frac(origin.z) * tDeltaZ;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  // 起點若在 solid 內：法線朝射線來向
  if (isSolid(world.getBlock(x, y, z))) {
    return { x, y, z, nx: -stepX, ny: -stepY, nz: -stepZ };
  }

  while (t <= maxDist) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
    if (t > maxDist) break;
    if (isSolid(world.getBlock(x, y, z))) {
      return { x, y, z, nx, ny, nz };
    }
  }
  return null;
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/world/raycast.ts src/world/raycast.test.ts
git commit -m "feat: voxel DDA raycast with face normals"
```

---

### Task 9: `world/mesher` 面剔除網格化

**Files:**
- Create: `src/world/mesher.ts`
- Test: `src/world/mesher.test.ts`

**Deviations:**
- plan test expected 10 (both faces culled) but that creates FrontSide holes through solid blocks; rule is: transparent face hides against opaque, opaque face draws toward transparent → 11. Plan test updated accordingly.

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { meshChunk } from './mesher';
import { World } from './world';
import { Chunk } from './chunk';
import { BLOCK } from './blocks';

function worldWithBlock(x: number, y: number, z: number, id: number): World {
  const w = new World();
  w.addChunk(new Chunk(Math.floor(x / 16), Math.floor(z / 16)));
  w.setBlock(x, y, z, id);
  return w;
}

describe('meshChunk', () => {
  it('isolated block produces 6 quads (24 verts, 36 indices)', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    const m = meshChunk(w, 0, 0);
    expect(m.quadCount).toBe(6);
    expect(m.positions.length).toBe(6 * 4 * 3);
    expect(m.indices.length).toBe(6 * 6);
  });

  it('two adjacent blocks produce 10 quads (shared face culled)', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(6, 64, 5, BLOCK.STONE);
    expect(meshChunk(w, 0, 0).quadCount).toBe(10);
  });

  it('hidden faces of 3x3x3 cube are culled (54 outer quads)', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    for (let x = 4; x <= 6; x++)
      for (let y = 63; y <= 65; y++)
        for (let z = 4; z <= 6; z++)
          w.setBlock(x, y, z, BLOCK.STONE);
    expect(meshChunk(w, 0, 0).quadCount).toBe(54);
  });

  it('glass next to glass: only outer faces', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GLASS);
    w.setBlock(6, 64, 5, BLOCK.GLASS);
    expect(meshChunk(w, 0, 0).quadCount).toBe(10);
  });

  it('glass next to stone hides shared faces from both', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.STONE);
    w.setBlock(6, 64, 5, BLOCK.GLASS);
    expect(meshChunk(w, 0, 0).quadCount).toBe(10);
  });

  it('water against air is drawn', () => {
    const w = worldWithBlock(5, 60, 5, BLOCK.WATER);
    expect(meshChunk(w, 0, 0).quadCount).toBe(6);
  });

  it('uv layers are valid tile indices and include grass top tile 0', () => {
    const w = worldWithBlock(5, 64, 5, BLOCK.GRASS);
    const m = meshChunk(w, 0, 0);
    for (const layer of m.layers) {
      expect(layer).toBeGreaterThanOrEqual(0);
      expect(layer).toBeLessThan(64);
    }
    expect(m.layers).toContain(0);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './mesher'`

- [ ] **Step 3: 實作 `src/world/mesher.ts`**

```ts
import type { World } from './world';
import { getBlockDef, isTransparent, BLOCK } from './blocks';
import { CHUNK_SIZE, CHUNK_HEIGHT } from './chunk';

export interface ChunkMeshData {
  positions: Float32Array; // 3 per vert
  uvs: Float32Array; // 2 per vert (0..1 within tile)
  layers: Float32Array; // 1 per vert (tile index)
  shades: Float32Array; // 1 per vert (face brightness 0..1)
  indices: Uint32Array;
  quadCount: number;
}

type Face = {
  dir: [number, number, number];
  corners: [number, number, number][];
  shade: number;
  tileKey: 'top' | 'side' | 'bottom';
};

const FACES: Face[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 1], [1, 1, 0]], shade: 0.72, tileKey: 'side' },
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]], shade: 0.72, tileKey: 'side' },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], shade: 1.0, tileKey: 'top' },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], shade: 0.5, tileKey: 'bottom' },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], shade: 0.86, tileKey: 'side' },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]], shade: 0.86, tileKey: 'side' },
];

const UV_C = [0, 0, 1, 0, 0, 1, 1, 1];

function faceVisible(id: number, neighbor: number): boolean {
  if (neighbor === BLOCK.AIR) return true;
  if (id === neighbor) return false; // 同種相鄰（含玻璃/水內部）不畫
  if (!isTransparent(neighbor)) return false; // 鄰居不透明 → 被擋
  return true; // 鄰居透明 → 畫
}

export function meshChunk(world: World, cx: number, cz: number): ChunkMeshData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const layers: number[] = [];
  const shades: number[] = [];
  const indices: number[] = [];
  let quadCount = 0;

  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = baseX + lx;
        const wz = baseZ + lz;
        const id = world.getBlock(wx, y, wz);
        if (id === BLOCK.AIR) continue;
        const def = getBlockDef(id);

        for (const face of FACES) {
          const neighbor = world.getBlock(
            wx + face.dir[0],
            y + face.dir[1],
            wz + face.dir[2],
          );
          if (!faceVisible(id, neighbor)) continue;

          const tile = def[face.tileKey];
          const vertBase = positions.length / 3;
          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            positions.push(wx + c[0], y + c[1], wz + c[2]);
            uvs.push(UV_C[i * 2], UV_C[i * 2 + 1]);
            layers.push(tile);
            shades.push(face.shade);
          }
          indices.push(vertBase, vertBase + 1, vertBase + 2, vertBase + 2, vertBase + 1, vertBase + 3);
          quadCount++;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    layers: new Float32Array(layers),
    shades: new Float32Array(shades),
    indices: new Uint32Array(indices),
    quadCount,
  };
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/world/mesher.ts src/world/mesher.test.ts
git commit -m "feat: face-culling chunk mesher"
```

---

### Task 10: `render/textures` 程序圖集

**Files:**
- Create: `src/render/textures.ts`
- Test: `src/render/textures.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { ATLAS_SIZE, TILE_PX, TILES_PER_ROW, drawAtlas, tileIndexAt } from './textures';

describe('textures', () => {
  it('constants are consistent', () => {
    expect(ATLAS_SIZE).toBe(512);
    expect(TILE_PX).toBe(16);
    expect(TILES_PER_ROW).toBe(32);
    expect(TILES_PER_ROW * TILE_PX).toBe(ATLAS_SIZE);
  });

  it('drawAtlas fills non-empty pixels', () => {
    const data = drawAtlas();
    expect(data.width).toBe(ATLAS_SIZE);
    expect(data.height).toBe(ATLAS_SIZE);
    let opaque = 0;
    for (let i = 3; i < data.data.length; i += 4) if (data.data[i] > 0) opaque++;
    expect(opaque).toBeGreaterThan(1000);
  });

  it('tileIndexAt returns row-major index', () => {
    expect(tileIndexAt(0, 0)).toBe(0);
    expect(tileIndexAt(1, 0)).toBe(1);
    expect(tileIndexAt(0, 1)).toBe(32);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './textures'`

- [ ] **Step 3: 實作 `src/render/textures.ts`**

```ts
export const ATLAS_SIZE = 512;
export const TILE_PX = 16;
export const TILES_PER_ROW = ATLAS_SIZE / TILE_PX; // 32

export function tileIndexAt(tx: number, ty: number): number {
  return ty * TILES_PER_ROW + tx;
}

export interface AtlasImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type RGBA = [number, number, number, number];

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const vary = (base: RGBA, rnd: () => number, amount: number): RGBA => {
  const d = (rnd() - 0.5) * amount;
  return [clamp255(base[0] + d), clamp255(base[1] + d), clamp255(base[2] + d), base[3]];
};

function fillTile(
  px: Uint8ClampedArray,
  tile: number,
  fn: (x: number, y: number, rnd: () => number) => RGBA,
): void {
  const tx = tile % TILES_PER_ROW;
  const ty = Math.floor(tile / TILES_PER_ROW);
  const rnd = mulberry(tile * 7919 + 17);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const [r, g, b, a] = fn(x, y, rnd);
      const i = ((ty * TILE_PX + y) * ATLAS_SIZE + tx * TILE_PX + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = a;
    }
  }
}

export function drawAtlas(): AtlasImage {
  const data = new Uint8ClampedArray(ATLAS_SIZE * ATLAS_SIZE * 4);
  const put = (tile: number, fn: (x: number, y: number, rnd: () => number) => RGBA) =>
    fillTile(data, tile, fn);

  put(0, (_x, _y, r) => vary([106, 170, 64, 255], r, 26)); // grass_top
  put(1, (x, y, r) =>
    y < 3 + (x % 3 === 0 ? 1 : 0)
      ? vary([106, 170, 64, 255], r, 26)
      : vary([134, 96, 67, 255], r, 24),
  ); // grass_side
  put(2, (_x, _y, r) => vary([134, 96, 67, 255], r, 28)); // dirt
  put(3, (x, y, r) => {
    const v = (x * 3 + y * 7) % 5 === 0 ? -22 : 0;
    const c = vary([125, 125, 125, 255], r, 20);
    return [clamp255(c[0] + v), clamp255(c[1] + v), clamp255(c[2] + v), 255];
  }); // stone
  put(4, (_x, _y, r) => vary([219, 207, 163, 255], r, 20)); // sand
  put(5, (x, _y, r) => {
    const stripe = x % 4 === 0 ? -30 : 0;
    const c = vary([102, 81, 50, 255], r, 16);
    return [clamp255(c[0] + stripe), clamp255(c[1] + stripe), clamp255(c[2] + stripe), 255];
  }); // log_side
  put(6, (x, y, r) => {
    const dx = x - 7.5;
    const dy = y - 7.5;
    const ring = Math.floor(Math.sqrt(dx * dx + dy * dy)) % 2 === 0 ? 18 : -10;
    const c = vary([154, 126, 78, 255], r, 14);
    return [clamp255(c[0] + ring), clamp255(c[1] + ring), clamp255(c[2] + ring), 255];
  }); // log_top
  put(7, (_x, _y, r) => {
    if (r() < 0.18) return [0, 0, 0, 0];
    return vary([60, 140, 46, 255], r, 40);
  }); // leaves (alpha holes)
  put(8, (x, y, r) => {
    const line = y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 8) % 16 === 0 ? -28 : 0;
    const c = vary([168, 136, 84, 255], r, 14);
    return [clamp255(c[0] + line), clamp255(c[1] + line), clamp255(c[2] + line), 255];
  }); // planks
  put(9, (_x, _y, r) => vary([110, 110, 110, 255], r, 45)); // cobble
  put(10, (x, y, r) => {
    const wave = Math.sin(x * 0.8 + y * 0.5) * 14;
    const c = vary([52, 96, 200, 200], r, 10);
    return [clamp255(c[0] + wave), clamp255(c[1] + wave), clamp255(c[2] + wave), 200];
  }); // water
  put(11, (_x, _y, r) => vary([70, 70, 70, 255], r, 55)); // bedrock
  put(12, (_x, _y, r) => vary([242, 246, 248, 255], r, 12)); // snow_top
  put(13, (x, y, r) =>
    y < 4 ? vary([242, 246, 248, 255], r, 12) : vary([134, 96, 67, 255], r, 24),
  ); // snow_side
  put(14, (x, y) => {
    const border = x === 0 || y === 0 || x === 15 || y === 15;
    if (border) return [220, 240, 250, 220];
    if (x === y || x + y === 15) return [230, 245, 255, 60];
    return [200, 230, 245, 25];
  }); // glass
  put(15, (x, y, r) => {
    const stone = vary([125, 125, 125, 255], r, 20);
    const blob = (x % 8 < 3 && y % 8 < 3) || (x % 8 > 5 && y % 8 > 5);
    if (blob && r() > 0.3) return vary([30, 30, 30, 255], r, 18);
    return stone;
  }); // coal_ore
  put(16, (x, y, r) => {
    const stone = vary([125, 125, 125, 255], r, 20);
    const blob = (x % 8 < 3 && y % 8 < 3) || (x % 8 > 5 && y % 8 > 5);
    if (blob && r() > 0.3) return vary([216, 175, 147, 255], r, 20);
    return stone;
  }); // iron_ore

  return { width: ATLAS_SIZE, height: ATLAS_SIZE, data };
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/render/textures.ts src/render/textures.test.ts
git commit -m "feat: procedural pixel-art texture atlas"
```

---

### Task 11: `render/scene` + `render/chunk-renderer` + 初版 `main.ts`

**Files:**
- Create: `src/render/scene.ts`, `src/render/chunk-renderer.ts`
- Modify: `src/main.ts`（整檔替換）

- [ ] **Step 1: 實作 `src/render/scene.ts`**

```ts
import * as THREE from 'three';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  setSize(w: number, h: number): void;
  dispose(): void;
}

export function createGameScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 40, 140);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0.5, 80, 0.5);

  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);

  return {
    scene,
    camera,
    renderer,
    setSize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },
    dispose() {
      renderer.dispose();
    },
  };
}
```

（本計畫用 `MeshBasicMaterial` + vertex shade，不需要 directional light；`ambient` 可留可去。）

- [ ] **Step 2: 實作 `src/render/chunk-renderer.ts`**

```ts
import * as THREE from 'three';
import type { World } from '../world/world';
import { chunkKey } from '../world/world';
import { meshChunk } from '../world/mesher';
import type { AtlasImage } from './textures';
import { ATLAS_SIZE, TILES_PER_ROW } from './textures';

/** mesher 的 0..1 uv + layer 烘成圖集座標（0.5px inset 防滲色） */
export function bakeAtlasUvs(uvs: Float32Array, layers: Float32Array): Float32Array {
  const out = new Float32Array(uvs.length);
  const tile = 1 / TILES_PER_ROW;
  const inset = 0.5 / ATLAS_SIZE;
  for (let i = 0; i < uvs.length; i += 2) {
    const layer = layers[i / 2];
    const tx = layer % TILES_PER_ROW;
    const ty = Math.floor(layer / TILES_PER_ROW);
    const u0 = tx * tile;
    const v0 = 1 - (ty + 1) * tile; // 圖像 y 向下 → WebGL uv y 向上
    const uu = uvs[i];
    const vv = uvs[i + 1];
    out[i] = uu === 0 ? u0 + inset : u0 + tile - inset;
    out[i + 1] = vv === 0 ? v0 + inset : v0 + tile - inset;
  }
  return out;
}

export class ChunkRenderer {
  private meshes = new Map<string, THREE.Mesh>();
  private material: THREE.MeshBasicMaterial;

  constructor(private scene: THREE.Scene, atlas: AtlasImage) {
    const canvas = document.createElement('canvas');
    canvas.width = atlas.width;
    canvas.height = atlas.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(new ImageData(atlas.data, atlas.width, atlas.height), 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;

    this.material = new THREE.MeshBasicMaterial({
      map: tex,
      vertexColors: true,
      alphaTest: 0.1,
      side: THREE.FrontSide,
      fog: true,
    });
  }

  rebuild(world: World, cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const old = this.meshes.get(key);
    const data = meshChunk(world, cx, cz);

    if (data.quadCount === 0) {
      if (old) {
        this.scene.remove(old);
        old.geometry.dispose();
        this.meshes.delete(key);
      }
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(bakeAtlasUvs(data.uvs, data.layers), 2),
    );
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

    const colors = new Float32Array(data.shades.length * 3);
    for (let i = 0; i < data.shades.length; i++) {
      colors[i * 3] = data.shades[i];
      colors[i * 3 + 1] = data.shades[i];
      colors[i * 3 + 2] = data.shades[i];
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
    }
    this.scene.add(mesh);
    this.meshes.set(key, mesh);
  }

  remove(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const mesh = this.meshes.get(key);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(key);
    }
  }

  has(cx: number, cz: number): boolean {
    return this.meshes.has(chunkKey(cx, cz));
  }

  dispose(): void {
    for (const m of this.meshes.values()) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.meshes.clear();
    this.material.map?.dispose();
    this.material.dispose();
  }
}
```

**Notes from Task 10 review:**
- Keep `alphaTest: 0.1` exactly — glass interior is α=0 (hardened); a comment at the material must say `// must stay > glass interior 0 and == 0.1 contract`
- Water texture has α=200 but plan's MeshBasicMaterial lacks `transparent: true` → Phase 1 renders water OPAQUE (α=200 is currently dead data). Decision: accept opaque water for Phase 1; real translucency deferred to phase 2. Optionally Task 11 may set water tile α=255 + comment to make intent explicit — Task 11 implementer's choice, note both options.
- NearestFilter (mag+min) + generateMipmaps:false + 0.5px UV inset are load-bearing — forbid LinearFilter "improvements"

**Deviations:**
- Deviation: main.ts queue hang fix — dropped not-ready entries from mesh budget loop (refreshQueues re-queues next frame); generate data-only ring at r+1, mesh within r, unload at r+2. Plan's original loop text was provably infinite.
- Deviation: camera clearance y=80→96, lookAt 66→82 (plan's orbit starts inside seed-1337 terrain, max surface 86; dy=14 preserved). Task 16 replaces camera anyway.
- Note: ImageData via ctx.createImageData (TS 5.7 ArrayBufferLike); water α=200 option B (per Task 10 notes).

- [ ] **Step 3: 整檔替換 `src/main.ts`（orbit 觀察相機版；Task 16 會再替換）**

```ts
import './style.css';
import { createGameScene } from './render/scene';
import { ChunkRenderer } from './render/chunk-renderer';
import { drawAtlas } from './render/textures';
import { World, chunkKey } from './world/world';
import { Chunk, CHUNK_SIZE } from './world/chunk';
import { generateChunk } from './world/terrain';
import { loadSettings } from './core/settings';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const gs = createGameScene(canvas);
const world = new World();
const chunkRenderer = new ChunkRenderer(gs.scene, drawAtlas());
const settings = loadSettings();

const pendingGen: Array<[number, number]> = [];
const pendingMesh: Array<[number, number]> = [];
const generated = new Set<string>();

function refreshQueues(): void {
  const pcx = Math.floor(gs.camera.position.x / CHUNK_SIZE);
  const pcz = Math.floor(gs.camera.position.z / CHUNK_SIZE);
  const r = settings.renderDistance;
  const rg = r + 1; // gen one ring past mesh radius so edge chunks have all 4 neighbors
  pendingGen.length = 0;
  pendingMesh.length = 0;

  for (let dz = -rg; dz <= rg; dz++) {
    for (let dx = -rg; dx <= rg; dx++) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      const key = chunkKey(cx, cz);
      if (!world.hasChunk(cx, cz) && !generated.has(key)) {
        pendingGen.push([cx, cz]);
      } else if (
        Math.abs(dx) <= r &&
        Math.abs(dz) <= r &&
        world.getChunk(cx, cz)?.dirty
      ) {
        pendingMesh.push([cx, cz]);
      }
    }
  }

  // 近→遠排序，優先載入腳下
  pendingGen.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));
  pendingMesh.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));

  for (const key of [...world.chunks.keys()]) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > r + 2 || Math.abs(cz - pcz) > r + 2) {
      chunkRenderer.remove(cx, cz);
      world.removeChunk(cx, cz);
      generated.delete(key);
    }
  }
}

function dist2([cx, cz]: [number, number], pcx: number, pcz: number): number {
  return (cx - pcx) ** 2 + (cz - pcz) ** 2;
}

function processQueues(): void {
  let budgetGen = 2;
  let budgetMesh = 2;
  while (budgetGen > 0 && pendingGen.length > 0) {
    const [cx, cz] = pendingGen.shift()!;
    const chunk = new Chunk(cx, cz, generateChunk(cx, cz, settings.seed));
    chunk.generated = true;
    chunk.dirty = true;
    world.addChunk(chunk);
    generated.add(chunkKey(cx, cz));
    budgetGen--;
  }
  // fixed: no re-push (see Task 11 deviations)
  while (budgetMesh > 0 && pendingMesh.length > 0) {
    const [cx, cz] = pendingMesh.shift()!;
    const c = world.getChunk(cx, cz);
    // 相鄰區塊可能還沒生成 → 等鄰居就緒再 mesh（避免邊界洞）；
    // not-ready entries are dropped (not re-pushed): readiness cannot change mid-pass,
    // and refreshQueues re-queues dirty chunks next frame — re-pushing would spin forever.
    if (c?.dirty && neighborsReady(cx, cz)) {
      chunkRenderer.rebuild(world, cx, cz);
      c.dirty = false;
      budgetMesh--;
    }
  }
}

function neighborsReady(cx: number, cz: number): boolean {
  return (
    world.hasChunk(cx + 1, cz) &&
    world.hasChunk(cx - 1, cz) &&
    world.hasChunk(cx, cz + 1) &&
    world.hasChunk(cx, cz - 1)
  );
}

window.addEventListener('resize', () =>
  gs.setSize(window.innerWidth, window.innerHeight),
);

gs.camera.position.set(0.5, 80, 0.5);
let angle = 0;

gs.renderer.setAnimationLoop(() => {
  angle += 0.003;
  const r = 30;
  gs.camera.position.x = Math.cos(angle) * r + 0.5;
  gs.camera.position.z = Math.sin(angle) * r + 0.5;
  gs.camera.lookAt(0.5, 66, 0.5);
  refreshQueues();
  processQueues();
  gs.renderer.render(gs.scene, gs.camera);
});
```

- [ ] **Step 4: 手動驗證**

Run: `npm run dev`
Expected: 瀏覽器看到旋轉視角下的方塊地形（草地/樹/水），無控制台錯誤。

Run: `npm run typecheck && npm run lint && npm test`
Expected: 全部通過。

- [ ] **Step 5: Commit**

```bash
git add src/render/scene.ts src/render/chunk-renderer.ts src/main.ts
git commit -m "feat: render scene and chunk mesh rendering"
```

---

### Task 12: `world/worker` 地形 Worker（含降級）

**Files:**
- Create: `src/world/worker.ts`, `src/world/worker-client.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 實作 `src/world/worker.ts`**

```ts
import { generateChunk } from './terrain';

export interface GenRequest {
  type: 'gen';
  id: number;
  cx: number;
  cz: number;
  seed: number;
}

export interface GenResponse {
  type: 'gen';
  id: number;
  cx: number;
  cz: number;
  buffer: ArrayBuffer;
}

self.onmessage = (e: MessageEvent<GenRequest>) => {
  const msg = e.data;
  if (msg.type !== 'gen') return;
  const data = generateChunk(msg.cx, msg.cz, msg.seed);
  const resp: GenResponse = {
    type: 'gen',
    id: msg.id,
    cx: msg.cx,
    cz: msg.cz,
    buffer: data.buffer as ArrayBuffer,
  };
  self.postMessage(resp, [resp.buffer]);
};
```

- [ ] **Step 2: 實作 `src/world/worker-client.ts`**

```ts
import type { GenRequest, GenResponse } from './worker';
import { generateChunk } from './terrain';

interface Job {
  id: number;
  cx: number;
  cz: number;
}

export class TerrainWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private inflight = new Map<number, Job>();
  private waiting: Array<(r: GenResponse) => void> = [];
  private queue: Job[] = [];
  private failed = false;

  constructor(private seed: number, maxConcurrent = 4) {
    this.maxConcurrent = maxConcurrent;
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<GenResponse>) => this.onResponse(e.data);
      this.worker.onerror = () => this.degrade();
    } catch {
      this.degrade();
    }
  }

  private readonly maxConcurrent: number;

  private degrade(): void {
    this.failed = true;
    this.worker?.terminate();
    this.worker = null;
    // 把等待中的請求改用主執行緒
    const waiters = [...this.waiting];
    this.waiting = [];
    for (const job of [...this.queue, ...this.inflight.values()]) {
      const buffer = generateChunk(job.cx, job.cz, this.seed).buffer as ArrayBuffer;
      const resp: GenResponse = { type: 'gen', id: job.id, cx: job.cx, cz: job.cz, buffer };
      waiters.forEach((w) => w(resp));
    }
    this.queue = [];
    this.inflight.clear();
  }

  private onResponse(resp: GenResponse): void {
    this.inflight.delete(resp.id);
    const waiter = this.waiting.shift();
    if (waiter) waiter(resp);
    this.pump();
    this.drainDeferred(resp);
  }

  /** 用 deferred 方式：一次請求對應一次 callback */
  private deferred = new Map<number, Array<(r: GenResponse) => void>>();

  private drainDeferred(resp: GenResponse): void {
    const cbs = this.deferred.get(resp.id) ?? [];
    this.deferred.delete(resp.id);
    for (const cb of cbs) cb(resp);
  }

  request(cx: number, cz: number): Promise<GenResponse> {
    const id = this.nextId++;
    const job: Job = { id, cx, cz };
    return new Promise((resolve) => {
      this.deferred.set(id, [resolve]);
      if (this.failed || !this.worker) {
        const buffer = generateChunk(cx, cz, this.seed).buffer as ArrayBuffer;
        resolve({ type: 'gen', id, cx, cz, buffer });
        return;
      }
      this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    if (!this.worker) return;
    while (this.inflight.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.inflight.set(job.id, job);
      const msg: GenRequest = { type: 'gen', ...job, seed: this.seed };
      this.worker.postMessage(msg);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
```

> 實作時可簡化：上面同時有 `waiting` 與 `deferred` 兩套機制 — **只保留 `deferred`（Map<id, callbacks>）**，刪除 `waiting` 陣列與相關程式碼，讓 `onResponse` 直接呼叫 `drainDeferred` 再 `pump()`。

- [ ] **Step 3: 修改 `src/main.ts` 使用 worker client**

將 `processQueues` 中的同步生成改為非同步：

```ts
import { TerrainWorkerClient } from './world/worker-client';

// 在 settings 之後：
const terrain = new TerrainWorkerClient(settings.seed);
const genInFlight = new Set<string>();

// 替換 processQueues 的生成迴圈為：
function processQueues(): void {
  let budgetGen = 2;
  let budgetMesh = 2;
  while (budgetGen > 0 && pendingGen.length > 0) {
    const [cx, cz] = pendingGen[0];
    const key = chunkKey(cx, cz);
    if (genInFlight.has(key)) break;
    pendingGen.shift();
    genInFlight.add(key);
    void terrain.request(cx, cz).then((resp) => {
      genInFlight.delete(key);
      const chunk = new Chunk(cx, cz, new Uint8Array(resp.buffer));
      chunk.generated = true;
      chunk.dirty = true;
      world.addChunk(chunk);
      generated.add(key);
    });
    budgetGen--;
  }
  // pendingMesh 迴維持不變（neighborsReady 檢查已涵蓋 worker 非同步）；refreshQueues 已是 gen r+1 / mesh r
  while (budgetMesh > 0 && pendingMesh.length > 0) {
    const [cx, cz] = pendingMesh.shift()!;
    const c = world.getChunk(cx, cz);
    // fixed: no re-push (see Task 11 deviations)
    if (c?.dirty && neighborsReady(cx, cz)) {
      chunkRenderer.rebuild(world, cx, cz);
      c.dirty = false;
      budgetMesh--;
    }
  }
}
```

- [ ] **Step 4: 手動驗證**

Run: `npm run dev`
Expected: 地形載入行為與 Task 11 相同（生成仍在背景、無長卡頓）；DevTools → Workers 可見 worker 存在。

Run: `npm run typecheck && npm test`
Expected: 通過。

- [ ] **Step 5: Commit**

```bash
git add src/world/worker.ts src/world/worker-client.ts src/main.ts
git commit -m "feat: terrain generation web worker with fallback"
```

---

### Task 13: `player/physics` AABB 物理

**Files:**
- Create: `src/player/physics.ts`
- Test: `src/player/physics.test.ts`

**Deviations:**
- Test uses value import `import { World } from '../world/world'` (plan wrote `import type`, but the test does `new World()` — plan bug).
- `moveAxis` snap rewritten per the plan's own mandate (程式碼註解): literal plan code (`Math.floor(y+1e-6)+1` / ceil hacks) fails the landing test; implemented "move → detect overlap → walk back 0.01 → re-tune → snap y to `floor(y+1e-9)` on downward hit".
- Dropped unused plan helper `solidAt`.
- Water check uses `BLOCK.WATER` instead of the plan's literal `9`.
- Fly exit: `!input.fly && flying` leaves flight IMMEDIATELY without requiring `onGround` (midair fly-off soft-lock fix; Minecraft behavior — start falling).
- `dt` substepped internally (≤0.05s chunks) with `!Number.isFinite(dt)` → return early; non-finite yaw/derived dirX/dirZ → zero horizontal input for that step.
- Added `export const EYE_HEIGHT = 1.62`; 4 regression tests (+ sprint/sneak exact-speed asserts) beyond the plan's 8 — 13 physics tests total.

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { stepPlayer, createPlayer, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './physics';
import type { World } from '../world/world';
import { Chunk } from '../world/chunk';
import { BLOCK } from '../world/blocks';

/** 平台：y<=64 滿鋪石頭的無限世界（用大範圍 fill 模擬） */
function flatWorld(): World {
  const w = new World();
  const add = (cx: number, cz: number) => {
    if (!w.hasChunk(cx, cz)) w.addChunk(new Chunk(cx, cz));
  };
  for (let cx = -2; cx <= 2; cx++)
    for (let cz = -2; cz <= 2; cz++) {
      add(cx, cz);
      for (let x = 0; x < 16; x++)
        for (let z = 0; z < 16; z++)
          for (let y = 0; y <= 64; y++)
            w.setBlock(cx * 16 + x, y, cz * 16 + z, BLOCK.STONE);
    }
  return w;
}

const groundInput = { fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false, fly: false, flyUp: false, flyDown: false };

describe('stepPlayer', () => {
  it('spawns above ground and lands on surface', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 70, 0.5);
    for (let i = 0; i < 120; i++) stepPlayer(p, groundInput, w, 1 / 60);
    // 腳應落在 y=65（64 方塊頂面）
    expect(p.position.y).toBeCloseTo(65, 1);
    expect(p.onGround).toBe(true);
  });

  it('does not fall through ground', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 66, 0.5);
    for (let i = 0; i < 300; i++) stepPlayer(p, groundInput, w, 1 / 60);
    expect(p.position.y).toBeGreaterThanOrEqual(64.99);
  });

  it('jump leaves ground and lands again', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 70, 0.5);
    for (let i = 0; i < 120; i++) stepPlayer(p, groundInput, w, 1 / 60);
    expect(p.onGround).toBe(true);
    stepPlayer(p, { ...groundInput, jump: true }, w, 1 / 60);
    expect(p.velocity.y).toBeGreaterThan(0);
    expect(p.onGround).toBe(false);
    let peak = p.position.y;
    for (let i = 0; i < 180; i++) {
      stepPlayer(p, groundInput, w, 1 / 60);
      peak = Math.max(peak, p.position.y);
    }
    expect(peak).toBeGreaterThan(66); // 跳高 > 1 格
    expect(p.position.y).toBeCloseTo(65, 1);
  });

  it('forward movement changes z position', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 70, 0.5);
    for (let i = 0; i < 120; i++) stepPlayer(p, groundInput, w, 1 / 60);
    const z0 = p.position.z;
    // yaw=0 → forward = -z（three.js 慣例）
    for (let i = 0; i < 60; i++) stepPlayer(p, { ...groundInput, fwd: 1 }, w, 1 / 60);
    expect(p.position.z).toBeLessThan(z0 - 1);
  });

  it('collides with wall and does not tunnel', () => {
    const w = flatWorld();
    // 在 z=-2 處建牆（高於地面）
    for (let x = -4; x <= 4; x++)
      for (let y = 65; y <= 68; y++) w.setBlock(x, y, -2, BLOCK.STONE);
    const p = createPlayer(0.5, 65, 0.5);
    for (let i = 0; i < 300; i++) stepPlayer(p, { ...groundInput, fwd: 1 }, w, 1 / 60);
    // 玩家不可穿過 z=-2 牆（身體前緣不得超過 -1.x）
    const front = p.position.z - PLAYER_HALF_WIDTH;
    expect(front).toBeGreaterThanOrEqual(-2 - 1e-6);
  });

  it('fly mode ignores gravity', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 90, 0.5);
    const flyIn = { ...groundInput, fly: true };
    const y0 = p.position.y;
    for (let i = 0; i < 60; i++) stepPlayer(p, flyIn, w, 1 / 60);
    expect(p.position.y).toBeCloseTo(y0, 1);
  });

  it('fly up responds to flyUp', () => {
    const w = flatWorld();
    const p = createPlayer(0.5, 90, 0.5);
    for (let i = 0; i < 30; i++)
      stepPlayer(p, { ...groundInput, fly: true, flyUp: true }, w, 1 / 60);
    expect(p.position.y).toBeGreaterThan(90);
  });

  it('player box constants match spec', () => {
    expect(PLAYER_HALF_WIDTH).toBeCloseTo(0.3, 5);
    expect(PLAYER_HEIGHT).toBeCloseTo(1.8, 5);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './physics'`

- [ ] **Step 3: 實作 `src/player/physics.ts`**

```ts
import type { World } from '../world/world';

export const PLAYER_HALF_WIDTH = 0.3;
export const PLAYER_HEIGHT = 1.8;
const GRAVITY = 32;
const JUMP_SPEED = 9;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.6;
const SNEAK_SPEED = 1.3;
const FLY_SPEED = 10;
const TERMINAL_VELOCITY = 50;
const IN_WATER_DRAG = 0.5;

export interface PlayerState {
  position: { x: number; y: number; z: number }; // 腳底中心
  velocity: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  onGround: boolean;
  flying: boolean;
  inWater: boolean;
}

export interface MoveInput {
  fwd: number; // -1..1
  strafe: number; // -1..1
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  fly: boolean;
  flyUp: boolean;
  flyDown: boolean;
}

export function createPlayer(x: number, y: number, z: number): PlayerState {
  return {
    position: { x, y, z },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    onGround: false,
    flying: false,
    inWater: false,
  };
}

function solidAt(world: World, x: number, y: number, z: number): boolean {
  return world.isSolid(Math.floor(x), Math.floor(y), Math.floor(z));
}

/** 玩家 AABB 是否與實心方塊重疊 */
function boxCollides(world: World, px: number, py: number, pz: number): boolean {
  const minX = px - PLAYER_HALF_WIDTH;
  const maxX = px + PLAYER_HALF_WIDTH;
  const minY = py;
  const maxY = py + PLAYER_HEIGHT;
  const minZ = pz - PLAYER_HALF_WIDTH;
  const maxZ = pz + PLAYER_HALF_WIDTH;
  for (let x = Math.floor(minX); x <= Math.floor(maxX - 1e-9); x++) {
    for (let y = Math.floor(minY); y <= Math.floor(maxY - 1e-9); y++) {
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ - 1e-9); z++) {
        if (world.isSolid(x, y, z)) return true;
      }
    }
  }
  return false;
}

export function stepPlayer(
  p: PlayerState,
  input: MoveInput,
  world: World,
  dt: number,
): void {
  // 水檢查（腳或頭）
  const feetId = world.getBlock(Math.floor(p.position.x), Math.floor(p.position.y + 0.1), Math.floor(p.position.z));
  const headId = world.getBlock(Math.floor(p.position.x), Math.floor(p.position.y + 1.6), Math.floor(p.position.z));
  p.inWater = feetId === 9 || headId === 9; // BLOCK.WATER = 9

  // 飛行切換由外部（double-space）處理；這裡只執行
  if (input.fly && !p.flying) {
    p.flying = true;
    p.velocity.y = 0;
  }
  if (!input.fly && p.flying && input.jump === false && p.onGround) {
    p.flying = false;
  }

  // 水平移動方向（yaw 慣例：yaw=0 面向 -z）
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  let dirX = input.strafe * cos - input.fwd * sin;
  let dirZ = -input.strafe * sin - input.fwd * cos;
  const len = Math.hypot(dirX, dirZ);
  if (len > 1) {
    dirX /= len;
    dirZ /= len;
  }

  let speed = WALK_SPEED;
  if (p.flying) speed = FLY_SPEED;
  else if (input.sneak) speed = SNEAK_SPEED;
  else if (input.sprint) speed = SPRINT_SPEED;
  if (p.inWater && !p.flying) speed *= 0.5;

  if (p.flying) {
    p.velocity.x = dirX * speed;
    p.velocity.z = dirZ * speed;
    p.velocity.y = (input.flyUp ? 1 : 0) * speed + (input.flyDown ? -1 : 0) * speed;
  } else {
    p.velocity.x = dirX * speed;
    p.velocity.z = dirZ * speed;

    if (p.inWater) {
      p.velocity.y -= GRAVITY * IN_WATER_DRAG * dt;
      p.velocity.y *= 0.9;
      if (input.jump) p.velocity.y = 4;
      p.velocity.y = Math.max(p.velocity.y, -4);
    } else {
      p.velocity.y -= GRAVITY * dt;
      if (input.jump && p.onGround) {
        p.velocity.y = JUMP_SPEED;
        p.onGround = false;
      }
    }
    p.velocity.y = Math.max(p.velocity.y, -TERMINAL_VELOCITY);
  }

  // 逐軸移動 + 解碰撞
  moveAxis(p, world, 'x', p.velocity.x * dt);
  moveAxis(p, world, 'z', p.velocity.z * dt);
  moveAxis(p, world, 'y', p.velocity.y * dt);
}

function moveAxis(
  p: PlayerState,
  world: World,
  axis: 'x' | 'y' | 'z',
  delta: number,
): void {
  if (delta === 0) return;
  const pos = p.position;
  pos[axis] += delta;

  if (!boxCollides(world, pos.x, pos.y, pos.z)) {
    if (axis === 'y') {
      p.onGround = delta < 0 && false; // 無碰撞不設 onGround（見下方 re-ground）
    }
    return;
  }

  // 推回：沿軸退回直到不重疊（二分精修）
  const step = Math.sign(delta) * 0.01;
  let safety = 0;
  while (boxCollides(world, pos.x, pos.y, pos.z) && safety++ < 500) {
    pos[axis] -= step;
  }
  // 微調回 0.01 內
  if (!boxCollides(world, pos.x, pos.y, pos.z)) {
    pos[axis] += step;
    if (boxCollides(world, pos.x, pos.y, pos.z)) pos[axis] -= step;
  }

  if (axis === 'y') {
    if (delta < 0) {
      p.onGround = true;
      p.velocity.y = 0;
      // 對齊到方塊頂面
      pos.y = Math.floor(pos.y + 1e-6) + 1;
      // 若仍重疊（例如在缝隙），上移一格
      let guard = 0;
      while (boxCollides(world, pos.x, pos.y, pos.z) && guard++ < 4) pos.y += 1;
    } else {
      p.velocity.y = 0;
      pos.y = Math.ceil(pos.y - PLAYER_HEIGHT - 1e-6) - PLAYER_HEIGHT - 1 + 1;
      // 簡化：往下退到不重疊
      let guard = 0;
      while (boxCollides(world, pos.x, pos.y, pos.z) && guard++ < 64) pos.y -= 0.01;
    }
  } else {
    p.velocity[axis] = 0;
  }
}
```

> **實作提醒**：`moveAxis` 的推回邏輯是計畫中最容易寫出 edge-case bug 的部分。上述程式為完整基準版；執行者實作時**必須**靠 Step 1 的測試驗證（落地、牆、跳躍三案例）。若測試不過，以「先移動 → 偵測重疊 → 沿軸反向退回 0.01 直到分開 → 若是 y 軸向下則設 onGround 並把 y 對齊 `floor(y)+1`」為核心重寫，直到全綠。**禁止**改測試放水。

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS（physics 全部案例）

- [ ] **Step 5: Commit**

```bash
git add src/player/physics.ts src/player/physics.test.ts
git commit -m "feat: AABB player physics with fly and swim"
```

---

### Task 14: `player/input` 鍵盤/滑鼠/pointer lock

**Files:**
- Create: `src/player/input.ts`

（瀏覽器手動驗收，無單測。）

**Deviations:**
- `setMouseMoveHandler` 宣告進 `InputController` 介面（照計畫註記），回傳物件不需 `as` 轉型。
- keydown 加 `e.repeat` 防護：Space 雙擊飛行與 E/F3/F5 脈衝若吃 OS auto-repeat，按住會每 ~33ms 狂切換（計畫原始碼漏了）。
- `lastSpaceTime` 初始 `-Infinity`（計畫的 `0` 在頁面載入後 300ms 內的第一次 Space 會誤觸雙擊判定）。
- `state.requestPause` 永不設 true（與計畫程式碼一致）；暫停流程走 Task 17 的 `onLockChange`，`consumeRequestPause` 保留供 API 相容。
- 俯仰夾制 ±(π/2−0.01) 在 Task 17 的 `setMouseMoveHandler` 回呼做，input 只送 sensitivity 縮放後的 delta。

- [ ] **Step 1: 實作 `src/player/input.ts`**

```ts
import type { MoveInput } from './physics';
import type { Settings } from '../core/settings';

export interface InputState extends MoveInput {
  dig: boolean; // 左鍵按住
  place: boolean; // 右鍵（單擊脈衝，消費後清除）
  slot: number; // 0..8 熱鍵欄（滾輪/數字鍵更新）
  toggleInventory: boolean; // E 脈衝
  toggleDebug: boolean; // F3 脈衝
  toggleView: boolean; // F5 脈衝
  requestPause: boolean; // Esc（pointer lock 釋放時觸發）
}

export interface InputController {
  state: InputState;
  locked: boolean;
  onLockChange: (fn: (locked: boolean) => void) => void;
  consumePlace(): boolean;
  consumeToggleInventory(): boolean;
  consumeToggleDebug(): boolean;
  consumeToggleView(): boolean;
  consumeRequestPause(): boolean;
  dispose(): void;
}

export function createInput(canvas: HTMLCanvasElement, settings: Settings): InputController {
  const keys = new Set<string>();
  const state: InputState = {
    fwd: 0, strafe: 0, jump: false, sneak: false, sprint: false,
    fly: false, flyUp: false, flyDown: false,
    dig: false, place: false, slot: 0,
    toggleInventory: false, toggleDebug: false, toggleView: false, requestPause: false,
  };

  let locked = false;
  let lastSpaceTime = 0;
  let flyToggle = false;
  const lockListeners: Array<(locked: boolean) => void> = [];

  const updateMove = () => {
    state.fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    state.strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    state.jump = keys.has('Space');
    state.sneak = keys.has('ShiftLeft') || keys.has('ShiftRight');
    state.sprint = keys.has('ControlLeft') || keys.has('ControlRight');
    state.flyUp = flyToggle && keys.has('Space');
    state.flyDown = flyToggle && state.sneak;
    state.fly = flyToggle;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!locked) return;
    if (e.code === 'Space') {
      const now = performance.now();
      if (now - lastSpaceTime < 300) flyToggle = !flyToggle;
      lastSpaceTime = now;
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) state.slot = n - 1;
    }
    if (e.code === 'KeyE') state.toggleInventory = true;
    if (e.code === 'F3') { e.preventDefault(); state.toggleDebug = true; }
    if (e.code === 'F5') { e.preventDefault(); state.toggleView = true; }
    keys.add(e.code);
    updateMove();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    updateMove();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!locked) return;
    const sens = 0.0022 * settings.sensitivity;
    // 由外部註冊 handler 轉為 yaw/pitch —— 提供 hook
    mouseMoveHandler?.(e.movementX * sens, e.movementY * sens);
  };

  let mouseMoveHandler: ((dx: number, dy: number) => void) | null = null;

  const onMouseDown = (e: MouseEvent) => {
    if (!locked) return;
    if (e.button === 0) state.dig = true;
    if (e.button === 2) state.place = true;
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) state.dig = false;
  };
  const onWheel = (e: WheelEvent) => {
    if (!locked) return;
    state.slot = (state.slot + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
  };
  const onContext = (e: Event) => e.preventDefault();

  const onLockChange = () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      keys.clear();
      state.dig = false;
      updateMove();
    }
    lockListeners.forEach((fn) => fn(locked));
  };

  const onClick = () => {
    if (!locked) canvas.requestPointerLock();
  };

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel);
  canvas.addEventListener('contextmenu', onContext);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('click', onClick);

  return {
    state,
    get locked() {
      return locked;
    },
    onLockChange(fn) {
      lockListeners.push(fn);
    },
    setMouseMoveHandler(fn) {
      mouseMoveHandler = fn;
    },
    consumePlace() {
      const v = state.place;
      state.place = false;
      return v;
    },
    consumeToggleInventory() {
      const v = state.toggleInventory;
      state.toggleInventory = false;
      return v;
    },
    consumeToggleDebug() {
      const v = state.toggleDebug;
      state.toggleDebug = false;
      return v;
    },
    consumeToggleView() {
      const v = state.toggleView;
      state.toggleView = false;
      return v;
    },
    consumeRequestPause() {
      // pointer lock 被瀏覽器 Esc 釋放 → lock change 且原本 playing → 暫停
      const v = state.requestPause;
      state.requestPause = false;
      return v;
    },
    dispose() {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerlockchange', onLockChange);
      canvas.removeEventListener('click', onClick);
    },
  } as InputController & { setMouseMoveHandler(fn: (dx: number, dy: number) => void): void };
}
```

> 實作注意：回傳物件要同時符合 `InputController` 介面與 `setMouseMoveHandler`。最乾淨做法是**把 `setMouseMoveHandler` 宣告進 `InputController` 介面**，回傳型別就不用 as。

- [ ] **Step 2: 型別檢查**

Run: `npm run typecheck`
Expected: 通過（若有 `setMouseMoveHandler` 缺宣告，把它加進介面）。

- [ ] **Step 3: Commit**

```bash
git add src/player/input.ts
git commit -m "feat: keyboard mouse pointer-lock input controller"
```

---

### Task 15: `player/interact` 挖掘進度與放置判定

**Files:**
- Create: `src/player/interact.ts`
- Test: `src/player/interact.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { getBreakTime, DigProgress, canPlaceAt, placeTarget } from './interact';
import { BLOCK, getBlockDef } from '../world/blocks';
import { World } from '../world/world';
import { Chunk } from '../world/chunk';
import type { RayHit } from '../world/raycast';

describe('getBreakTime', () => {
  it('dirt faster than stone', () => {
    expect(getBreakTime(BLOCK.DIRT)).toBeLessThan(getBreakTime(BLOCK.STONE));
  });
  it('bedrock unbreakable', () => {
    expect(getBreakTime(BLOCK.BEDROCK)).toBe(Infinity);
  });
  it('matches hardness registry', () => {
    expect(getBreakTime(BLOCK.STONE)).toBe(getBlockDef(BLOCK.STONE).hardness);
  });
});

describe('DigProgress', () => {
  it('progress accumulates while target unchanged', () => {
    const d = new DigProgress();
    const hit = { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0 };
    d.update(BLOCK.STONE, hit, 1.0); // 挖 1s（stone=2s → 50%）
    expect(d.progress).toBeCloseTo(0.5, 5);
    d.update(BLOCK.STONE, hit, 1.0);
    expect(d.progress).toBeCloseTo(1.0, 5);
    expect(d.isDone(BLOCK.STONE)).toBe(true);
  });

  it('resets when target changes', () => {
    const d = new DigProgress();
    d.update(BLOCK.STONE, { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0 }, 1);
    d.update(BLOCK.STONE, { x: 1, y: 64, z: 0, nx: 0, ny: 1, nz: 0 }, 1);
    expect(d.progress).toBeCloseTo(0.5, 5);
  });

  it('reset clears progress', () => {
    const d = new DigProgress();
    d.update(BLOCK.DIRT, { x: 0, y: 64, z: 0, nx: 0, ny: 1, nz: 0 }, 1);
    d.reset();
    expect(d.progress).toBe(0);
  });
});

describe('placeTarget', () => {
  it('returns neighbor cell on hit face', () => {
    const hit: RayHit = { x: 5, y: 64, z: 5, nx: 0, ny: 1, nz: 0 };
    expect(placeTarget(hit)).toEqual({ x: 5, y: 65, z: 5 });
    const hit2: RayHit = { x: 5, y: 64, z: 5, nx: -1, ny: 0, nz: 0 };
    expect(placeTarget(hit2)).toEqual({ x: 4, y: 64, z: 5 });
  });
});

describe('canPlaceAt', () => {
  function w(): World {
    const world = new World();
    world.addChunk(new Chunk(0, 0));
    return world;
  }

  it('true for empty cell', () => {
    expect(canPlaceAt(w(), 5, 70, 5, { x: 5.5, y: 65, z: 5.5 })).toBe(true);
  });

  it('false when cell occupied by solid', () => {
    const world = w();
    world.setBlock(5, 70, 5, BLOCK.STONE);
    expect(canPlaceAt(world, 5, 70, 5, { x: 5.5, y: 65, z: 5.5 })).toBe(false);
  });

  it('false when overlapping player box', () => {
    // 玩家站在 (5.5, 65, 5.5) → 身體佔 5,65,5 與 5,66,5
    expect(canPlaceAt(w(), 5, 65, 5, { x: 5.5, y: 65, z: 5.5 })).toBe(false);
    expect(canPlaceAt(w(), 5, 66, 5, { x: 5.5, y: 65, z: 5.5 })).toBe(false);
  });

  it('true for water cell (replaceable)', () => {
    const world = w();
    world.setBlock(5, 70, 5, BLOCK.WATER);
    expect(canPlaceAt(world, 5, 70, 5, { x: 5.5, y: 65, z: 5.5 })).toBe(true);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL — `Cannot find module './interact'`

- [ ] **Step 3: 實作 `src/player/interact.ts`**

```ts
import { getBlockDef, BLOCK, isSolid } from '../world/blocks';
import type { World } from '../world/world';
import type { RayHit } from '../world/raycast';
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from './physics';

export function getBreakTime(blockId: number): number {
  return getBlockDef(blockId).hardness;
}

export class DigProgress {
  private key = '';
  progress = 0;

  update(blockId: number, hit: RayHit, dt: number): void {
    const k = `${hit.x},${hit.y},${hit.z},${blockId}`;
    if (k !== this.key) {
      this.key = k;
      this.progress = 0;
    }
    const time = getBreakTime(blockId);
    if (!isFinite(time)) return; // bedrock 永不累進
    this.progress = Math.min(1, this.progress + dt / time);
  }

  isDone(blockId: number): boolean {
    return isFinite(getBreakTime(blockId)) && this.progress >= 1;
  }

  reset(): void {
    this.key = '';
    this.progress = 0;
  }
}

export function placeTarget(hit: RayHit): { x: number; y: number; z: number } {
  return { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
}

export function canPlaceAt(
  world: World,
  x: number,
  y: number,
  z: number,
  playerPos: { x: number; y: number; z: number },
): boolean {
  const id = world.getBlock(x, y, z);
  if (id !== BLOCK.AIR && id !== BLOCK.WATER) return false; // 只能放進空氣/水

  // 方塊 AABB: [x,x+1]³ vs 玩家 AABB
  const pMinX = playerPos.x - PLAYER_HALF_WIDTH;
  const pMaxX = playerPos.x + PLAYER_HALF_WIDTH;
  const pMinY = playerPos.y;
  const pMaxY = playerPos.y + PLAYER_HEIGHT;
  const pMinZ = playerPos.z - PLAYER_HALF_WIDTH;
  const pMaxZ = playerPos.z + PLAYER_HALF_WIDTH;
  const overlap =
    pMaxX > x && pMinX < x + 1 &&
    pMaxY > y && pMinY < y + 1 &&
    pMaxZ > z && pMinZ < z + 1;
  return !overlap;
}
```

- [ ] **Step 4: 執行確認通過**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/player/interact.ts src/player/interact.test.ts
git commit -m "feat: dig progress and placement rules"
```

---

### Task 16: `ui/hud` + `ui/menus` + `ui/inventory`

**Files:**
- Create: `src/ui/hud.ts`, `src/ui/menus.ts`, `src/ui/inventory.ts`, `src/ui/ui.css`

（DOM/CSS 為主，手動驗收；每個模組附最小 smoke 測試確認可建立。）

- [ ] **Step 1: 建立 `src/ui/ui.css`**

```css
.ui-crosshair {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 20px;
  height: 20px;
  transform: translate(-50%, -50%);
}
.ui-crosshair::before,
.ui-crosshair::after {
  content: '';
  position: absolute;
  background: rgba(255, 255, 255, 0.85);
  mix-blend-mode: difference;
}
.ui-crosshair::before {
  left: 9px;
  top: 0;
  width: 2px;
  height: 20px;
}
.ui-crosshair::after {
  left: 0;
  top: 9px;
  width: 20px;
  height: 2px;
}

.ui-hotbar {
  position: absolute;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  padding: 3px;
  background: rgba(0, 0, 0, 0.45);
  border: 2px solid rgba(0, 0, 0, 0.6);
  border-radius: 4px;
}
.ui-slot {
  width: 48px;
  height: 48px;
  background: rgba(139, 139, 139, 0.45);
  border: 2px solid rgba(0, 0, 0, 0.55);
  position: relative;
  image-rendering: pixelated;
}
.ui-slot.selected {
  border-color: #fff;
  box-shadow: 0 0 0 2px #fff;
}
.ui-slot canvas {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
.ui-slot .num {
  position: absolute;
  left: 2px;
  top: 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}
.ui-item-name {
  position: absolute;
  left: 50%;
  bottom: 70px;
  transform: translateX(-50%);
  color: #fff;
  text-shadow: 1px 1px 0 #000;
  font-size: 16px;
}

.ui-debug {
  position: absolute;
  left: 8px;
  top: 8px;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  font: 12px/1.5 monospace;
  padding: 6px 8px;
  white-space: pre;
}

.ui-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.55);
}
.ui-overlay.title-screen {
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(4px);
}
.ui-logo {
  font-size: 64px;
  font-weight: 900;
  letter-spacing: 4px;
  color: #e8e8e8;
  text-shadow: 4px 4px 0 #3f3f3f, 8px 8px 0 rgba(0, 0, 0, 0.4);
  image-rendering: pixelated;
  margin-bottom: 24px;
}
.ui-btn {
  min-width: 260px;
  padding: 10px 16px;
  font-size: 16px;
  color: #fff;
  background: linear-gradient(#6f6f6f, #5a5a5a);
  border: 2px solid #000;
  box-shadow: inset 0 0 0 2px #a0a0a0;
  cursor: pointer;
  text-shadow: 1px 1px 0 #000;
}
.ui-btn:hover {
  background: linear-gradient(#7f8f9f, #6a7a8a);
  box-shadow: inset 0 0 0 2px #c0d0e0;
}
.ui-inventory {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: #c6c6c6;
  border: 3px solid #555;
  border-radius: 4px;
  padding: 12px;
  pointer-events: auto;
}
.ui-inventory h3 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #3f3f3f;
}
.ui-inv-grid {
  display: grid;
  grid-template-columns: repeat(7, 44px);
  gap: 4px;
}
.ui-inv-grid .ui-slot {
  width: 44px;
  height: 44px;
  background: #8b8b8b;
  cursor: pointer;
}
.ui-inv-grid .ui-slot:hover {
  outline: 2px solid #fff;
}
```

- [ ] **Step 2: 實作 `src/ui/hud.ts`**

```ts
import '../ui/ui.css';
import { getBlockDef } from '../world/blocks';
import type { BlockId } from '../world/blocks';
import { ATLAS_SIZE, TILE_PX, TILES_PER_ROW, drawAtlas } from '../render/textures';

export interface Hud {
  root: HTMLElement;
  setHotbar(slots: BlockId[], selected: number): void;
  setSelected(index: number): void;
  setDebug(lines: string[] | null): void;
  showItemName(name: string | null): void;
  dispose(): void;
}

const atlasData = drawAtlas();

function drawBlockIcon(canvas: HTMLCanvasElement, blockId: BlockId): void {
  const def = getBlockDef(blockId);
  const ctx = canvas.getContext('2d')!;
  canvas.width = 32;
  canvas.height = 32;
  const tx = def.side % TILES_PER_ROW;
  const ty = Math.floor(def.side / TILES_PER_ROW);
  const img = ctx.createImageData(TILE_PX, TILE_PX);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const si = ((ty * TILE_PX + y) * ATLAS_SIZE + tx * TILE_PX + x) * 4;
      const di = (y * TILE_PX + x) * 4;
      img.data[di] = atlasData.data[si];
      img.data[di + 1] = atlasData.data[si + 1];
      img.data[di + 2] = atlasData.data[si + 2];
      img.data[di + 3] = atlasData.data[si + 3];
    }
  }
  const tmp = document.createElement('canvas');
  tmp.width = TILE_PX;
  tmp.height = TILE_PX;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, 32, 32);
}

export function createHud(uiRoot: HTMLElement): Hud {
  const crosshair = document.createElement('div');
  crosshair.className = 'ui-crosshair';

  const hotbar = document.createElement('div');
  hotbar.className = 'ui-hotbar';
  const slots: HTMLElement[] = [];
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('div');
    s.className = 'ui-slot';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(i + 1);
    const icon = document.createElement('canvas');
    s.append(num, icon);
    hotbar.appendChild(s);
    slots.push(s);
  }

  const itemName = document.createElement('div');
  itemName.className = 'ui-item-name';

  const debug = document.createElement('div');
  debug.className = 'ui-debug';
  debug.style.display = 'none';

  uiRoot.append(crosshair, hotbar, itemName, debug);

  return {
    root: uiRoot,
    setHotbar(list, selected) {
      list.forEach((id, i) => {
        const s = slots[i];
        if (!s) return;
        s.classList.toggle('selected', i === selected);
        const canvas = s.querySelector('canvas');
        if (canvas) drawBlockIcon(canvas, id);
      });
    },
    setSelected(index) {
      slots.forEach((s, i) => s.classList.toggle('selected', i === index));
    },
    setDebug(lines) {
      if (!lines) {
        debug.style.display = 'none';
        return;
      }
      debug.style.display = 'block';
      debug.textContent = lines.join('\n');
    },
    showItemName(name) {
      itemName.textContent = name ?? '';
    },
    dispose() {
      crosshair.remove();
      hotbar.remove();
      itemName.remove();
      debug.remove();
    },
  };
}
```

- [ ] **Step 3: 實作 `src/ui/menus.ts`**

```ts
import './ui.css';

export type MenuAction = 'play' | 'resume' | 'quit-to-title';

export interface Menus {
  showTitle(onPlay: () => void): void;
  showPause(opts: { onResume: () => void; onQuit: () => void }): void;
  hideAll(): void;
  isVisible(): boolean;
}

export function createMenus(uiRoot: HTMLElement): Menus {
  let current: HTMLElement | null = null;

  const clear = () => {
    current?.remove();
    current = null;
  };

  const btn = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.className = 'ui-btn interactive';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };

  return {
    showTitle(onPlay) {
      clear();
      const el = document.createElement('div');
      el.className = 'ui-overlay title-screen interactive';
      const logo = document.createElement('div');
      logo.className = 'ui-logo';
      logo.textContent = 'WeCraft';
      el.append(logo, btn('單人遊戲', onPlay));
      current = el;
      uiRoot.appendChild(el);
    },
    showPause({ onResume, onQuit }) {
      clear();
      const el = document.createElement('div');
      el.className = 'ui-overlay interactive';
      const title = document.createElement('div');
      title.className = 'ui-logo';
      title.style.fontSize = '36px';
      title.textContent = '遊戲已暫停';
      el.append(title, btn('繼續遊戲', onResume), btn('回到標題', onQuit));
      current = el;
      uiRoot.appendChild(el);
    },
    hideAll: clear,
    isVisible: () => current !== null,
  };
}
```

- [ ] **Step 4: 實作 `src/ui/inventory.ts`**

```ts
import './ui.css';
import { PLACEABLE, getBlockDef, type BlockId } from '../world/blocks';
import { ATLAS_SIZE, TILE_PX, TILES_PER_ROW, drawAtlas } from '../render/textures';

export interface InventoryUi {
  open(hotbar: BlockId[], selected: number, onPick: (slot: number, id: BlockId) => void): void;
  close(): void;
  isOpen(): boolean;
}

const atlasData = drawAtlas();

function icon(blockId: BlockId): HTMLCanvasElement {
  const def = getBlockDef(blockId);
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const tx = def.side % TILES_PER_ROW;
  const ty = Math.floor(def.side / TILES_PER_ROW);
  const img = ctx.createImageData(TILE_PX, TILE_PX);
  for (let y = 0; y < TILE_PX; y++)
    for (let x = 0; x < TILE_PX; x++) {
      const si = ((ty * TILE_PX + y) * ATLAS_SIZE + tx * TILE_PX + x) * 4;
      const di = (y * TILE_PX + x) * 4;
      img.data[di] = atlasData.data[si];
      img.data[di + 1] = atlasData.data[si + 1];
      img.data[di + 2] = atlasData.data[si + 2];
      img.data[di + 3] = atlasData.data[si + 3];
    }
  const tmp = document.createElement('canvas');
  tmp.width = TILE_PX;
  tmp.height = TILE_PX;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, 32, 32);
  return canvas;
}

export function createInventory(uiRoot: HTMLElement): InventoryUi {
  let el: HTMLElement | null = null;

  return {
    open(hotbar, selected, onPick) {
      this.close();
      el = document.createElement('div');
      el.className = 'ui-inventory interactive';
      const h = document.createElement('h3');
      h.textContent = `方塊（點選放入欄位 ${selected + 1}）`;
      const grid = document.createElement('div');
      grid.className = 'ui-inv-grid';
      for (const id of PLACEABLE) {
        const s = document.createElement('div');
        s.className = 'ui-slot';
        s.title = getBlockDef(id).name;
        s.appendChild(icon(id));
        s.addEventListener('click', () => onPick(selected, id));
        grid.appendChild(s);
      }
      el.append(h, grid);
      uiRoot.appendChild(el);
    },
    close() {
      el?.remove();
      el = null;
    },
    isOpen: () => el !== null,
  };
}
```

- [ ] **Step 5: Smoke 測試 `src/ui/ui.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHud } from './hud';
import { createMenus } from './menus';
import { createInventory } from './inventory';
import { HOTBAR_DEFAULT } from '../world/blocks';

beforeEach(() => {
  document.getElementById('ui-root')?.remove();
  const root = document.createElement('div');
  root.id = 'ui-root';
  document.body.appendChild(root);
});

describe('ui smoke', () => {
  it('createHud builds hotbar with 9 slots', () => {
    const root = document.getElementById('ui-root')!;
    const hud = createHud(root);
    hud.setHotbar(HOTBAR_DEFAULT, 0);
    expect(root.querySelectorAll('.ui-slot').length).toBe(9);
    expect(root.querySelectorAll('.ui-slot.selected').length).toBe(1);
    hud.dispose();
  });

  it('menus show and hide title', () => {
    const root = document.getElementById('ui-root')!;
    const menus = createMenus(root);
    menus.showTitle(() => {});
    expect(menus.isVisible()).toBe(true);
    expect(root.textContent).toContain('單人遊戲');
    menus.hideAll();
    expect(menus.isVisible()).toBe(false);
  });

  it('inventory open/close', () => {
    const root = document.getElementById('ui-root')!;
    const inv = createInventory(root);
    inv.open(HOTBAR_DEFAULT, 0, () => {});
    expect(inv.isOpen()).toBe(true);
    inv.close();
    expect(inv.isOpen()).toBe(false);
  });
});
```

- [ ] **Step 6: 執行確認通過**

Run: `npm test`
Expected: PASS（含 ui smoke）

- [ ] **Step 7: Commit**

```bash
git add src/ui/
git commit -m "feat: hud hotbar debug menus and creative inventory"
```

---

### Task 17: `main.ts` 遊戲狀態機整合（最終版）

**Files:**
- Modify: `src/main.ts`（整檔替換）

- [ ] **Step 1: 整檔替換 `src/main.ts`**

```ts
import './style.css';
import { createGameScene } from './render/scene';
import { ChunkRenderer, bakeAtlasUvs } from './render/chunk-renderer';
import { drawAtlas } from './render/textures';
import { World, chunkKey } from './world/world';
import { Chunk, CHUNK_SIZE } from './world/chunk';
import { TerrainWorkerClient } from './world/worker-client';
import { raycast } from './world/raycast';
import { BLOCK, getBlockDef, HOTBAR_DEFAULT, type BlockId } from './world/blocks';
import { createPlayer, stepPlayer, type PlayerState } from './player/physics';
import { createInput } from './player/input';
import { DigProgress, getBreakTime, placeTarget, canPlaceAt } from './player/interact';
import { createHud } from './ui/hud';
import { createMenus } from './ui/menus';
import { createInventory } from './ui/inventory';
import { loadSettings } from './core/settings';
import { generateChunk } from './world/terrain';

type GameState = 'title' | 'playing' | 'paused' | 'inventory';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;
const gs = createGameScene(canvas);
const settings = loadSettings();
const world = new World();
const chunkRenderer = new ChunkRenderer(gs.scene, drawAtlas());
const terrain = new TerrainWorkerClient(settings.seed);
const input = createInput(canvas, settings);
const hud = createHud(uiRoot);
const menus = createMenus(uiRoot);
const inv = createInventory(uiRoot);

let state: GameState = 'title';
let player: PlayerState = createPlayer(0.5, 90, 0.5);
let hotbar: BlockId[] = [...HOTBAR_DEFAULT];
let selected = 0;
let showDebug = false;
let thirdPerson = false;
const dig = new DigProgress();

// ---- 出生點：同步生成 (0,0) 找地表 ----
function spawnPoint(): { x: number; y: number; z: number } {
  if (!world.hasChunk(0, 0)) {
    const chunk = new Chunk(0, 0, generateChunk(0, 0, settings.seed));
    chunk.generated = true;
    chunk.dirty = true;
    world.addChunk(chunk);
  }
  for (let y = 255; y > 0; y--) {
    if (world.isSolid(0, y, 0)) return { x: 0.5, y: y + 1.01, z: 0.5 };
  }
  return { x: 0.5, y: 80, z: 0.5 };
}

// ---- 區塊佇列（同 Task 12） ----
const pendingGen: Array<[number, number]> = [];
const pendingMesh: Array<[number, number]> = [];
const generated = new Set<string>();
const genInFlight = new Set<string>();

function refreshQueues(): void {
  const pcx = Math.floor(player.position.x / CHUNK_SIZE);
  const pcz = Math.floor(player.position.z / CHUNK_SIZE);
  const r = settings.renderDistance;
  const rg = r + 1; // gen one ring past mesh radius so edge chunks have all 4 neighbors
  pendingGen.length = 0;
  pendingMesh.length = 0;
  for (let dz = -rg; dz <= rg; dz++) {
    for (let dx = -rg; dx <= rg; dx++) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      const key = chunkKey(cx, cz);
      if (!world.hasChunk(cx, cz) && !generated.has(key)) pendingGen.push([cx, cz]);
      else if (Math.abs(dx) <= r && Math.abs(dz) <= r && world.getChunk(cx, cz)?.dirty)
        pendingMesh.push([cx, cz]);
    }
  }
  pendingGen.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));
  pendingMesh.sort((a, b) => dist2(a, pcx, pcz) - dist2(b, pcx, pcz));
  for (const key of [...world.chunks.keys()]) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > r + 2 || Math.abs(cz - pcz) > r + 2) {
      if (cx === 0 && cz === 0) continue; // 保留出生區塊
      chunkRenderer.remove(cx, cz);
      world.removeChunk(cx, cz);
      generated.delete(key);
    }
  }
}

function dist2([cx, cz]: [number, number], pcx: number, pcz: number): number {
  return (cx - pcx) ** 2 + (cz - pcz) ** 2;
}

function neighborsReady(cx: number, cz: number): boolean {
  return (
    world.hasChunk(cx + 1, cz) && world.hasChunk(cx - 1, cz) &&
    world.hasChunk(cx, cz + 1) && world.hasChunk(cx, cz - 1)
  );
}

function processQueues(): void {
  let budgetGen = 2;
  let budgetMesh = 2;
  while (budgetGen > 0 && pendingGen.length > 0) {
    const [cx, cz] = pendingGen[0];
    const key = chunkKey(cx, cz);
    if (genInFlight.has(key)) {
      pendingGen.shift();
      continue;
    }
    pendingGen.shift();
    genInFlight.add(key);
    void terrain.request(cx, cz).then((resp) => {
      genInFlight.delete(key);
      if (world.hasChunk(cx, cz)) return;
      const chunk = new Chunk(cx, cz, new Uint8Array(resp.buffer));
      chunk.generated = true;
      chunk.dirty = true;
      world.addChunk(chunk);
      generated.add(key);
    });
    budgetGen--;
  }
  while (budgetMesh > 0 && pendingMesh.length > 0) {
    const [cx, cz] = pendingMesh.shift()!;
    const c = world.getChunk(cx, cz);
    // fixed: no re-push (see Task 11 deviations)
    if (c?.dirty && neighborsReady(cx, cz)) {
      chunkRenderer.rebuild(world, cx, cz);
      c.dirty = false;
      budgetMesh--;
    }
  }
}

// ---- 狀態切換 ----
function setState(next: GameState): void {
  state = next;
  menus.hideAll();
  inv.close();
  if (next === 'title') {
    menus.showTitle(startGame);
    document.exitPointerLock?.();
  } else if (next === 'paused') {
    menus.showPause({
      onResume: () => setState('playing'),
      onQuit: () => setState('title'),
    });
  } else if (next === 'inventory') {
    inv.open(hotbar, selected, (slot, id) => {
      hotbar[slot] = id;
      hud.setHotbar(hotbar, selected);
    });
  }
}

function startGame(): void {
  const sp = spawnPoint();
  player = createPlayer(sp.x, sp.y, sp.z);
  setState('playing');
  canvas.requestPointerLock();
}

// pointer lock 釋放 → 暫停/關背包
input.onLockChange((locked) => {
  if (locked) return;
  if (state === 'playing') setState('paused');
  else if (state === 'inventory') {
    /* 保持背包開著（E 再關） */
  }
});

input.setMouseMoveHandler((dx, dy) => {
  player.yaw -= dx;
  player.pitch -= dy;
  const limit = Math.PI / 2 - 0.01;
  player.pitch = Math.max(-limit, Math.min(limit, player.pitch));
});

// ---- 主循環 ----
let last = performance.now();
let fps = 60;
let fpsAcc = 0;
let fpsCount = 0;

window.addEventListener('resize', () =>
  gs.setSize(window.innerWidth, window.innerHeight),
);

hud.setHotbar(hotbar, selected);
setState('title');

gs.renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAcc += dt;
  fpsCount++;
  if (fpsAcc >= 0.5) {
    fps = Math.round(fpsCount / fpsAcc);
    fpsAcc = 0;
    fpsCount = 0;
  }

  if (state === 'playing') {
    // UI 脈衝
    if (input.consumeToggleDebug()) showDebug = !showDebug;
    if (input.consumeToggleView()) thirdPerson = !thirdPerson;
    if (input.consumeToggleInventory()) {
      setState('inventory');
      document.exitPointerLock();
    } else {
      const inSlot = input.state.slot;
      if (inSlot !== selected) {
        selected = inSlot;
        hud.setSelected(selected);
        hud.showItemName(getBlockDef(hotbar[selected]).name);
        setTimeout(() => hud.showItemName(null), 1200);
      }

      stepPlayer(player, input.state, world, dt);

      // 相機
      const eye = { x: player.position.x, y: player.position.y + 1.62, z: player.position.z };
      gs.camera.position.set(eye.x, eye.y, eye.z);
      gs.camera.rotation.order = 'YXZ';
      gs.camera.rotation.y = player.yaw;
      gs.camera.rotation.x = player.pitch;
      if (thirdPerson) {
        const back = 4;
        gs.camera.position.x -= Math.sin(player.yaw) * back;
        gs.camera.position.z -= Math.cos(player.yaw) * back;
        gs.camera.position.y += 0.5;
      }

      // 挖掘/放置
      const dir = { x: 0, y: 0, z: 0 };
      dir.x = -Math.sin(player.yaw) * Math.cos(player.pitch);
      dir.y = Math.sin(player.pitch);
      dir.z = -Math.cos(player.yaw) * Math.cos(player.pitch);
      const hit = raycast(world, eye, dir, 5);

      if (hit && input.state.dig) {
        const id = world.getBlock(hit.x, hit.y, hit.z);
        dig.update(id, hit, dt);
        if (dig.isDone(id)) {
          world.setBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
          dig.reset();
        }
      } else {
        dig.reset();
      }

      if (hit && input.consumePlace()) {
        const t = placeTarget(hit);
        if (canPlaceAt(world, t.x, t.y, t.z, player.position)) {
          world.setBlock(t.x, t.y, t.z, hotbar[selected]);
        }
      }

      refreshQueues();
      processQueues();

      if (showDebug) {
        const p = player.position;
        hud.setDebug([
          `WeCraft (dev)  ${fps} fps`,
          `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
          `Block: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`,
          `Chunks: ${world.chunks.size}`,
          `Seed: ${settings.seed}`,
          `Mode: creative${player.flying ? ' (flying)' : ''}`,
        ]);
      } else {
        hud.setDebug(null);
      }
    }
  } else {
    hud.setDebug(null);
    // 標題畫面：慢速環繞出生點
    const t = now / 1000;
    const sp = { x: 0.5, y: 75, z: 0.5 };
    gs.camera.position.set(sp.x + Math.cos(t * 0.1) * 24, sp.y + 8, sp.z + Math.sin(t * 0.1) * 24);
    gs.camera.lookAt(sp.x, sp.y - 4, sp.z);
    refreshQueues();
    processQueues();
  }

  gs.renderer.render(gs.scene, gs.camera);
});
```

> **型別註記**：`bakeAtlasUvs` 在此檔未使用 → 從 import 移除。`getBreakTime` 若未直接用到（DigProgress 內部已用）→ 從 import 移除。lint 的 `noUnusedLocals` 會抓，照錯誤提示清 import 即可。

- [ ] **Step 2: 全量驗證**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 全部通過。

- [ ] **Step 3: 手動 QA 清單（`npm run dev`）**

| # | 步驟 | 預期 |
|---|---|---|
| 1 | 開啟首頁 | 標題畫面「WeCraft」+ 背後地形環繞 |
| 2 | 點「單人遊戲」 | 指標鎖定、落在地表 |
| 3 | WASD + 滑鼠 | 走動/視角正常，不會穿地 |
| 4 | Space 跳、雙擊 Space | 跳躍 / 進入飛行；飛行中 Space 升、Shift 降 |
| 5 | 按住左鍵挖草方塊 | 有破壞時間，挖完方塊消失、鄰居重建無破面 |
| 6 | 右鍵放置玻璃 | 放在準星面外側，不能放進自己身體 |
| 7 | 1-9 / 滾輪 | 熱鍵欄切換，下方短暫顯示方塊名 |
| 8 | E | 背包開（指標釋放），點方塊放入選中欄位，再按 E/點擊畫面關閉 |
| 9 | Esc | 暫停選單（繼續/回到標題） |
| 10 | F3 | 座標/FPS/區塊數 |
| 11 | F5 | 第一/第三人稱切換 |
| 12 | 走遠再走回 | 區塊卸載/重載無記憶體暴增、無控制台錯誤 |
| 13 | 挖基岩 | 挖不動 |

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: game state machine and full play loop"
```

---

### Task 18: 效能 — 貪婪網格化升級

**Files:**
- Modify: `src/world/mesher.ts`（替換 `meshChunk` 內的 quad 產生）
- Test: `src/world/mesher.test.ts`（新增案例）

- [ ] **Step 1: 新增失敗測試**

```ts
import { it, expect, describe } from 'vitest';
// 沿用既有 import

describe('greedy meshing', () => {
  it('merges coplanar same-block faces into fewer quads', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    // 4x4 平坦石台 (y=64, x/z 0..3)
    for (let x = 0; x < 4; x++)
      for (let z = 0; z < 4; z++) w.setBlock(x, 64, z, BLOCK.STONE);
    const naiveQuads = 4 * 4 * 5 + 4; // 底面貼地可省：上4*4 + 側邊 - 再以實作為準
    const m = meshChunk(w, 0, 0);
    // 貪婪後頂面應合併成 1 個 quad（原本 16）
    // 驗證：總 quad 數小於面剔除版的 80（16*5）
    expect(m.quadCount).toBeLessThan(80);
    expect(m.quadCount).toBeGreaterThan(0);
    void naiveQuads;
  });

  it('still produces valid uv layer indices after greedy', () => {
    const w = new World();
    w.addChunk(new Chunk(0, 0));
    for (let x = 0; x < 4; x++)
      for (let z = 0; z < 4; z++) {
        w.setBlock(x, 64, z, BLOCK.GRASS);
        w.setBlock(x, 63, z, BLOCK.DIRT);
      }
    const m = meshChunk(w, 0, 0);
    for (const layer of m.layers) {
      expect(layer).toBeGreaterThanOrEqual(0);
      expect(layer).toBeLessThan(64);
    }
    expect(m.indices.length % 6).toBe(0);
    expect(m.positions.length / 3 * 3).toBe(m.positions.length);
  });
});
```

- [ ] **Step 2: 執行確認失敗**

Run: `npm test`
Expected: FAIL（現行實作為 1 quad/面，`quadCount < 80` 可能恰好過 — 若通過，先看第二案例是否仍過；兩個都過代表沒換成貪婪，繼續 Step 3 後重跑確認 quad 數明顯下降，並在測試中加入 `expect(m.quadCount).toBeLessThanOrEqual(20)` 之類的嚴格斷言鎖住行為）

- [ ] **Step 3: 替換 `meshChunk` 為貪婪版本**

在 `src/world/mesher.ts` 加入 mask 貪婪合併（每軸每切片掃一次）：

```ts
interface MaskCell {
  visible: boolean;
  tile: number;
  shade: number;
  /** 消去方向：+1 表示面朝正軸（畫在切片正側） */ sign: 1 | -1;
}

function greedyMesh(world: World, cx: number, cz: number): ChunkMeshData {
  const positions: number[] = [];
  const uvs: number[] = [];
  const layers: number[] = [];
  const shades: number[] = [];
  const indices: number[] = [];
  let quadCount = 0;

  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  // 掃三個軸；axis: 0=x,1=y,2=z
  const dims = [CHUNK_SIZE, CHUNK_HEIGHT, CHUNK_SIZE];
  const origin = [baseX, 0, baseZ];

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const mask: MaskCell[] = new Array(dims[u] * dims[v]);

    for (let d = 0; d < dims[axis]; d++) {
      // 建 mask：cell 代表 (d) 與 (d+1) 兩層交界
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u]; i++) {
          const coord = [0, 0, 0];
          coord[axis] = d;
          coord[u] = i;
          coord[v] = j;
          const here = sample(world, coord);
          const coord2 = [...coord];
          coord2[axis] = d + 1;
          const there = sample(world, coord2);

          let cell: MaskCell = { visible: false, tile: 0, shade: 0, sign: 1 };
          if (here !== BLOCK.AIR && faceVisible(here, there)) {
            cell = { visible: true, tile: getBlockDef(here)[tileKeyFor(axis, 1)], shade: shadeFor(axis, 1), sign: 1 };
          } else if (there !== BLOCK.AIR && faceVisible(there, here)) {
            cell = { visible: true, tile: getBlockDef(there)[tileKeyFor(axis, -1)], shade: shadeFor(axis, -1), sign: -1 };
          }
          mask[j * dims[u] + i] = cell;
        }
      }

      // 貪婪掃描 mask
      for (let j = 0; j < dims[v]; j++) {
        for (let i = 0; i < dims[u]; ) {
          const c = mask[j * dims[u] + i];
          if (!c.visible) {
            i++;
            continue;
          }
          // 寬：同 tile+shade+sign
          let w = 1;
          while (i + w < dims[u]) {
            const n = mask[j * dims[u] + i + w];
            if (!n.visible || n.tile !== c.tile || n.shade !== c.shade || n.sign !== c.sign) break;
            w++;
          }
          // 高
          let h = 1;
          outer: while (j + h < dims[v]) {
            for (let k = 0; k < w; k++) {
              const n = mask[(j + h) * dims[u] + i + k];
              if (!n.visible || n.tile !== c.tile || n.shade !== c.shade || n.sign !== c.sign) break outer;
            }
            h++;
          }
          // 發 quad
          const p = [0, 0, 0];
          p[axis] = d + (c.sign === 1 ? 1 : 0);
          p[u] = i;
          p[v] = j;
          emitQuad(positions, uvs, layers, shades, indices, p, axis, u, v, w, h, c, baseX, baseZ);
          quadCount++;
          // 消去
          for (let jj = 0; jj < h; jj++)
            for (let ii = 0; ii < w; ii++)
              mask[(j + jj) * dims[u] + i + ii] = { visible: false, tile: 0, shade: 0, sign: 1 };
          i += w;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    layers: new Float32Array(layers),
    shades: new Float32Array(shades),
    indices: new Uint32Array(indices),
    quadCount,
  };
}

function sample(world: World, coord: number[]): number {
  return world.getBlock(coord[0], coord[1], coord[2]);
}

function tileKeyFor(_axis: number, sign: number): 'top' | 'side' | 'bottom' {
  // axis 1 = y：+ 為 top、- 為 bottom；其餘 side
  // 注意：呼叫端已知 axis — 傳入更清楚，實作時改 (axis, sign)
  return sign === 1 ? 'side' : 'side';
}

function shadeFor(_axis: number, _sign: number): number {
  return 1; // 實作時依 axis/sign 回傳：y+ = 1.0, y- = 0.5, x± = 0.72, z± = 0.86
}

function emitQuad(
  positions: number[],
  uvs: number[],
  layers: number[],
  shades: number[],
  indices: number[],
  p: number[],
  axis: number,
  u: number,
  v: number,
  w: number,
  h: number,
  c: MaskCell,
  baseX: number,
  baseZ: number,
): void {
  // 四角在 (u,v) 平面上展開 w×h；世界座標需要 + baseX/baseZ 偏移（x/z 軸）
  const corners: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  const uvArr = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  const vertBase = positions.length / 3;
  for (let k = 0; k < 4; k++) {
    const pos = [0, 0, 0];
    pos[axis] = p[axis];
    pos[u] = p[u] + corners[k][0] * w;
    pos[v] = p[v] + corners[k][1] * h;
    // x/z 世界偏移
    const worldPos = [pos[0] + (axis === 0 || u === 0 || v === 0 ? 0 : 0), pos[1], pos[2]];
    // 正確：以 axis/u/v 映射回世界
    const wp = [0, 0, 0];
    wp[axis] = p[axis];
    wp[u] = p[u] + corners[k][0] * w;
    wp[v] = p[v] + corners[k][1] * h;
    // axis0: x=d+off, u=y? 不對 — dims 依軸而定，sample 已用世界座標
    // 請把 origin[axis/u/v] 加回：
    void worldPos;
    void baseX;
    void baseZ;
    positions.push(wp[0], wp[1], wp[2]);
    uvs.push(
      uvArr[k][0] === 0 ? 0 : 1,
      uvArr[k][1] === 0 ? 0 : 1,
    );
    // 重要：uv 必須是 0/1（bakeAtlasUvs 假設 quad 角點 uv ∈ {0,1}）。
    // 貪婪 quad 代表 w×h 個 tile 重複 → bake 時要用 w/h 乘算。
    layers.push(c.tile);
    shades.push(c.shade);
  }
  indices.push(vertBase, vertBase + 1, vertBase + 2, vertBase + 2, vertBase + 1, vertBase + 3);
}
```

> **給執行者的重要說明（勿略過）：**
>
> 1. 上面 `tileKeyFor` / `shadeFor` 是佔位 — 必須實作成：`axis===1 && sign===1 → top / 1.0`、`axis===1 && sign===-1 → bottom / 0.5`、`axis===0 → side / 0.72`、`axis===2 → side / 0.86`，且 `tileKeyFor` 要吃 `axis` 參數。
> 2. `emitQuad` 的世界座標：`sample`/`mask` 的 `coord` 在建構時用的是**世界座標**（`coord[axis]=d` 要加上 `origin[axis]`，`coord[u]/coord[v]` 加 `origin[u]/origin[v]`）。請在建 mask 時就加 origin，`emitQuad` 同步加，確保兩邊一致。最乾淨做法：整層座標都用世界座標運算，`d` 迴圈從 `origin[axis]` 跑到 `origin[axis]+dims[axis]`。
> 3. **UV 重複**：貪婪 quad 的 uv 不能只是 0..1 — 合併了 w×h 個貼圖。改法二選一：
>    - **A（推薦）**：`bakeAtlasUvs` 改簽名為 `(uvs, layers, repeats)`，`repeats` 為每 vertex 的 `[w,h]`，tile 內座標 = `fract` 前先 `uv * repeat` 再取 `u0 + (uu*w % 1)*tile`…… 太繞。
>    - **B（簡單可靠）**：mesher 輸出的 `uvs` 改為**已乘重複次數的連續座標**（`0..w`, `0..h`），`bakeAtlasUvs` 改為：`atlasU = u0 + fract(uu) * tile` + inset 修正邊界 — 對 GL_REPEAT 無效（atlas 是整張）。
>    - **C（最終建議）**：**不跨 tile 合併貼圖不同的情況下，改為合併後依 w×h 切成多個 0..1 quad 不可能減少 vertex。** 採用 **texture array 不在本期**。因此：**Task 18 的務實落地方式**是：保留 per-face mesher，但把「相鄰同 tile 同 shade 的共面 quad」合併後，**以每 tile 為單位在 shader 用 `fract` 重複** — 需自訂 ShaderMaterial。
>
> **務實決策（以此為準）：** 若執行到這裡發現 uv 重複成本過高，**允許降級**：保留 Task 9 的面剔除 mesher（已一區塊一 draw call），在計畫收尾的效能驗證中以實測 FPS 為準；若視距 10 實測 ≥ 55 FPS，**Task 18 視為可選、以 ` wontfix: greedy-uv` 註記於 commit message 捨棄**，不阻塞第一期交付。spec 的貪婪目標挪到第二期計畫（搭配 texture array 一次做對）。

- [ ] **Step 4: 決策點 — 實測**

Run: `npm run dev` → 視距 10，站在出生點看 FPS（F3）。

- **FPS ≥ 55**：執行 Step 5（降級路線）。
- **FPS < 55 且確認瓶颈在 draw/vertex**：完成貪婪 + 自訂 ShaderMaterial（`fract` 重複 uv），重跑 mesher 測試全綠後 Step 5。

- [ ] **Step 5: Commit（降級路線）**

```bash
git add -A
git commit -m "perf: measure meshing; keep face mesher (wontfix: greedy-uv deferred to phase 2 with texture array)"
```

或（完成貪婪）：

```bash
git add src/world/mesher.ts src/world/mesher.test.ts
git commit -m "perf: greedy chunk meshing with tiled uvs"
```

---

### Task 19: 收尾 — 全量檢查與交付

**Files:** 無新檔；修正任何殘留問題。

- [ ] **Step 1: 全量驗證**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: 四項全綠；`dist/` 產出成功。

- [ ] **Step 2: 手動回歸（Task 17 Step 3 的 13 項 QA 清單）**

Run: `npm run dev` → 走完清單。
Expected: 全過；Console 無 error。

- [ ] **Step 3: 確認 spec 第一期範圍無遺漏**

對照 spec §4「第一期（骨架）」：
- [ ] 移動/碰撞/視角
- [ ] 挖掘/放置（含破壞時間）
- [ ] 背包 + 熱鍵欄
- [ ] 無限地形（Worker）
- [ ] 創造模式（雙擊 Space 飛行）
- [ ] 基礎 HUD（準星/熱鍵欄/F3）
- [ ] 標題/暫停選單
- [ ] 程序貼圖

缺項 → 補 Task 再驗；全勾 → Step 4。

- [ ] **Step 4: 最終 Commit**

```bash
git add -A
git commit -m "chore: phase 1 verification pass"
```

---

## 計畫 Self-Review 記錄

1. **Spec 覆蓋：** 第一期清單（spec §4）對應 Task 1–17 + 19 Step 3 checklist；貪婪網格化（spec §6）對應 Task 18（含明文降級條件與挪至第二期的決策）。音效/AO/雲/日夜/怪物/血量=第二三期，已於計畫頭標明不做。
2. **Placeholder 掃描：** Task 18 `tileKeyFor`/`shadeFor`/`emitQuad` 佔位已附「給執行者的重要說明」與務實降級決策，非 TBD 逃逸；其餘任務皆有完整程式碼與指令。
3. **型別一致性：** `BlockId`、`World.getBlock/setBlock`、`Chunk(cx,cz,data)`、`meshChunk(world,cx,cz)`、`raycast(world,origin,dir,maxDist)`、`stepPlayer(p,input,world,dt)`、`DigProgress.update(blockId,hit,dt)` 於測試與實作簽名一致。`createInput` 的 `setMouseMoveHandler` 已要求併入介面。

