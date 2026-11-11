import * as THREE from 'three';
import type { XpOrb } from '../world/xp-orbs';

// 經驗球的視覺（B17 Task 3）。
//
// **為什麼另開一個模組**：`render/scene.ts` 已經有掉落物（`createDropRenderer`）與
// 生物的渲染工廠，但經驗球是 B17 新增的實體（`world/xp-orbs.ts`），形狀（小小的
// 發光方塊）與動作（浮動＋自轉）都和掉落物不同 → 不塞進 `scene.ts`。
//
// **結構完全比照 `createDropRenderer`**：
// - **共用一份 geometry ＋一份 material**（`BoxGeometry(0.25,0.25,0.25)` ＋
//   `MeshBasicMaterial({ color: 0x9bff5a })`）：經驗球沒有「每顆不同材質」的需求
//   （不會受擊閃白、不會分色），共用 → 不會隨球數洩漏材質／幾何。
// - **id-keyed 快取**：同一個 id 只更新位置／旋轉，不重建 mesh；消失的 id 立刻移除。
// - `dispose()` 移除所有 mesh、釋放共用的 geometry／material（可重複呼叫）。
//
// **模型是簡化的方塊**（README 的差異清單會列）：一顆 0.25 見方的綠色小方塊，
// 浮在球心上方 0.5 格處，並以 `sin(age·4)` 做 ±0.08 的上下浮動＋繞 Y 軸自轉。

/** 經驗球方塊的邊長（格）。 */
const ORB_SIZE = 0.25;
/** 發光綠（`MeshBasicMaterial` 不吃光 → 白天夜晚都一樣亮）。 */
const ORB_COLOR = 0x9bff5a;
/** 方塊浮在球心上方的高度（格）——球心在地表，方塊要看得見。 */
const ORB_LIFT = 0.5;
/** 上下浮動的幅度（格）。 */
const BOB_AMPLITUDE = 0.08;
/** 浮動頻率：`sin(age · BOB_FREQ)`。 */
const BOB_FREQ = 4;
/** 自轉角速度（弧度／秒）。 */
const SPIN_RATE = 3;

/** 經驗球渲染器的操作介面（B17 接線端用）。 */
export interface XpOrbView {
  /** 每幀把 `orbs` 對應成一組小方塊：新增／移動／浮動／自轉，並移除消失的球。
   *  `camera` 目前不影響外觀（位置是純世界座標），保留參數是為了和其他渲染工廠
   *  的呼叫端形狀一致。 */
  syncOrbs(orbs: readonly XpOrb[], camera: THREE.Camera, dt: number): void;
  /** 從場景移除所有經驗球並釋放共用的 geometry／material（可重複呼叫）。 */
  dispose(): void;
}

/**
 * 建立經驗球渲染器——每顆球一個 `THREE.Mesh`（共用幾何與材質），以 id 為鍵
 * 對齊 `orbs` 陣列。
 */
export function createXpOrbRenderer(scene: THREE.Scene): XpOrbView {
  const geometry = new THREE.BoxGeometry(ORB_SIZE, ORB_SIZE, ORB_SIZE);
  const material = new THREE.MeshBasicMaterial({ color: ORB_COLOR });
  /** id → mesh（id-keyed 快取）。 */
  const meshes = new Map<number, THREE.Mesh>();
  /** id → 最後一次出現的「世代」標記；用來偵測消失的 id，而不用每幀新建 Set。 */
  const seen = new Map<number, number>();
  let generation = 0;
  let disposed = false;

  // 提到 factory 外層的 callback → `meshes.forEach` 每幀不會再配置閉包。
  const dropStale = (mesh: THREE.Mesh, id: number): void => {
    if (seen.get(id) === generation) return;
    scene.remove(mesh);
    meshes.delete(id);
    seen.delete(id);
  };

  return {
    syncOrbs(orbs: readonly XpOrb[], _camera: THREE.Camera, dt: number): void {
      if (disposed) return;
      generation += 1;

      // ① 先標記這一幀還活著的 id（用世代號碼當 stamp → 不用每幀新建 Set）。
      for (let i = 0; i < orbs.length; i++) seen.set(orbs[i].id, generation);

      // ② 移除不存在的 id（iterate + delete 是安全的）。被吸收／超時消失的球
      //    下一幀就不會留在場景裡。
      meshes.forEach(dropStale);

      // ③ 再 upsert：同 id 只更新位置／旋轉，不重建 mesh。
      for (let i = 0; i < orbs.length; i++) {
        const orb = orbs[i];
        let mesh = meshes.get(orb.id);
        if (!mesh) {
          mesh = new THREE.Mesh(geometry, material);
          mesh.name = `xp-orb:${orb.id}`;
          meshes.set(orb.id, mesh);
          scene.add(mesh);
        }
        mesh.position.set(
          orb.pos.x,
          orb.pos.y + ORB_LIFT + BOB_AMPLITUDE * Math.sin(orb.age * BOB_FREQ),
          orb.pos.z,
        );
        // dt ≤ 0（或 NaN）時不轉——避免暫停／非有限 dt 把旋轉弄壞。
        if (dt > 0) mesh.rotation.y += dt * SPIN_RATE;
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes.values()) scene.remove(mesh);
      meshes.clear();
      seen.clear();
      // 共用的資源只釋放一次（每個 mesh 各自 dispose 會重複釋放同一份）。
      geometry.dispose();
      material.dispose();
    },
  };
}
