/** B2.4 的**無動畫**方塊人玩家模型——純渲染模組，不參與碰撞、不進物理。
 *
 *  **無動畫**：本模型完全沒有行走循環、沒有骨骼、沒有可旋轉的樞紐——四肢是靜態
 *  的 `THREE.Mesh`（與 `src/render/scene.ts` 的生物模型不同：生物的肢體是 pivot
 *  Group 以做擺動）。因此模型每幀只需設定一次位置／朝向。
 *
 *  **顯示場合**：只在**面後（back）／面前（front）**第三身視角顯示，第一人稱隱藏；
 *  由呼叫端（`src/main.ts`，Task 11 接線）以 `setVisible()` 切換。
 *
 *  **效能**：6 個盒子（頭／身／2 手臂／2 腿）× 每盒 12 三角形 ＝ 72 三角形，
 *  加 1 個臉部貼片（`PlaneGeometry`）＝ 2 三角形，合計 **74 三角形**。
 *
 *  **yaw 慣例**：臉部貼片朝 **−z**（yaw=0 時的玩家前方），與
 *  `src/player/physics.ts` 的 yaw 慣例一致 → 面前視角看得到玩家正面。
 *
 *  **比例**：模型原高 2.0 格，整體縮放 0.9 → 顯示高度 1.8 格，與玩家 hitbox
 *  同高（與生物模型的 `group.scale.setScalar(0.9)` 同一做法）；模型**腳底對齊**
 *  `setPose` 傳入的腳底座標（`player.position`），不是眼睛高度 → 底面貼地。
 *
 *  **材質**：沿用 `src/render/scene.ts` 生物模型的扁平調色盤風格——純色
 *  `MeshLambertMaterial`（會受日光／環境光影響），**不**貼圖、不進紋理陣列。 */
import * as THREE from 'three';
import { armorMaterialOf, type ArmorSet } from '../core/armor';

/** 玩家模型（第三身視角顯示的方塊人）。 */
export interface PlayerModel {
  /** 模型根節點（已加入場景；幾何／材質由本模組擁有）。 */
  group: THREE.Group;
  /** 把模型移到玩家的**腳底位置**並轉成玩家朝向（yaw 慣例：yaw=0 面向 −z）。
   *
   *  `feet` 指的是**腳底**（feet）座標——即 `src/player/physics.ts` 的
   *  `player.position`（玩家腳底所在的那一點），**不是**眼睛高度
   *  （`EYE_HEIGHT = 1.62` 的 `player.position.y + 1.62`）→ 模型底面貼合腳底、
   *  頂端 = 腳底 + 1.8 格，與 `PLAYER_HEIGHT = 1.8` 的玩家 hitbox 同高。
   *  若誤傳眼睛高度，模型會整個浮空 1.62 格。
   *
   *  非有限值（NaN／±∞）視為 0，避免壞值擴散成 NaN 汙染場景。 */
  setPose(feet: { x: number; y: number; z: number }, yaw: number): void;
  /** 切換整個模型的可見性（第一人稱隱藏、第三身顯示）。初始值沿用 Three 預設
   *  （可見），由呼叫端每幀同步當前視角。 */
  setVisible(visible: boolean): void;
  /** B12：依裝備中的四格盔甲切換外觀片（頭盔／胸甲／護腿／靴子）並依材質上色。
   *  空格 → 該片隱藏；不合法物品 id → 視為空。 */
  setArmor(set: ArmorSet): void;
  /** 從場景移除模型並釋放幾何與材質。
   *
   *  **非冪等**：每次呼叫都會再對 **4 個幾何**與 **4 個材質**各送一次 `dispose()`
   *  事件（呼叫兩次＝送兩次；Three 的 dispose 事件可重複送出，但會多派一次）→
   *  **呼叫端只應在釋放時呼叫一次**。 */
  dispose(): void;
}

/** 扁平調色盤（與生物模型的 `MOB_PALETTE` 同一風格）。 */
const SKIN_COLOR = 0xc9915f; // 膚色：頭＋手臂
const SHIRT_COLOR = 0x3f6fb5; // 上衣：身
const PANTS_COLOR = 0x35415c; // 褲子：腿
const FACE_COLOR = 0x2b1d12; // 臉部貼片（深褐色）

/** 模型整體縮放：原高 2.0 格 × 0.9 ＝ 1.8 格（與玩家 hitbox 同高）。 */
const MODEL_SCALE = 0.9;

/** B12：盔甲材質色（與 UI 圖示分開維護——這裡是渲染用數值）。 */
const ARMOR_COLORS = {
  leather: 0x8a5a2b,
  iron: 0x9aa7b4,
  golden: 0xf0c83c,
  diamond: 0x78dce8,
} as const;

/** 臉部貼片相對頭部 −z 面的浮出量（避免與頭部表面 z-fighting）。 */
const FACE_PROTRUDE = 0.01;

export function createPlayerModel(scene: THREE.Scene): PlayerModel {
  const group = new THREE.Group();
  group.name = 'player';
  group.scale.setScalar(MODEL_SCALE);

  // 幾何：頭／身／肢體共用同一組（模型只存在一份）。
  const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const bodyGeo = new THREE.BoxGeometry(0.5, 0.75, 0.25);
  const limbGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
  const faceGeo = new THREE.PlaneGeometry(0.4, 0.25);
  // B12：四片盔甲外觀（略大於對應部位；初始隱藏）。
  const armorHelmetGeo = new THREE.BoxGeometry(0.54, 0.5, 0.54);
  const armorChestGeo = new THREE.BoxGeometry(0.54, 0.5, 0.29);
  const armorLeggingsGeo = new THREE.BoxGeometry(0.54, 0.4, 0.27);
  const armorBootsGeo = new THREE.BoxGeometry(0.54, 0.2, 0.27);
  const geometries = [
    headGeo, bodyGeo, limbGeo, faceGeo,
    armorHelmetGeo, armorChestGeo, armorLeggingsGeo, armorBootsGeo,
  ];

  // 材質：純色 Lambert（頭與手臂共用膚色材質）。
  const skinMat = new THREE.MeshLambertMaterial({ color: SKIN_COLOR });
  const shirtMat = new THREE.MeshLambertMaterial({ color: SHIRT_COLOR });
  const pantsMat = new THREE.MeshLambertMaterial({ color: PANTS_COLOR });
  const faceMat = new THREE.MeshLambertMaterial({ color: FACE_COLOR });
  const armorHelmetMat = new THREE.MeshLambertMaterial({ color: ARMOR_COLORS.iron });
  const armorChestMat = new THREE.MeshLambertMaterial({ color: ARMOR_COLORS.iron });
  const armorLeggingsMat = new THREE.MeshLambertMaterial({ color: ARMOR_COLORS.iron });
  const armorBootsMat = new THREE.MeshLambertMaterial({ color: ARMOR_COLORS.iron });
  const materials = [
    skinMat, shirtMat, pantsMat, faceMat,
    armorHelmetMat, armorChestMat, armorLeggingsMat, armorBootsMat,
  ];

  // 頭：y 1.5–2.0
  const head = new THREE.Mesh(headGeo, skinMat);
  head.name = 'head';
  head.position.y = 1.75;

  // 身：y 0.75–1.5
  const body = new THREE.Mesh(bodyGeo, shirtMat);
  body.name = 'body';
  body.position.y = 1.125;

  // 手臂：x = ±0.375、y 0.75–1.5（與生物模型同樣的左右手位置）
  // **左右命名慣例**：`armL`／`legL` 放在 **+x** 側（與 `src/render/scene.ts` 的
  // 生物模型一致）。以 yaw=0（面向 −z）的解剖學方向來看，玩家自己的左手其實在
  // **−x** 側 → 這裡的「L」是**模型／螢幕左側**的慣例命名，**不是**玩家的解剖學
  // 左手；只影響節點名稱，不影響位置契約（位置由數值與測試釘住）。
  const armL = new THREE.Mesh(limbGeo, skinMat);
  armL.name = 'armL';
  armL.position.set(0.375, 1.125, 0);
  const armR = new THREE.Mesh(limbGeo, skinMat);
  armR.name = 'armR';
  armR.position.set(-0.375, 1.125, 0);

  // 腿：x = ±0.125、y 0–0.75
  const legL = new THREE.Mesh(limbGeo, pantsMat);
  legL.name = 'legL';
  legL.position.set(0.125, 0.375, 0);
  const legR = new THREE.Mesh(limbGeo, pantsMat);
  legR.name = 'legR';
  legR.position.set(-0.125, 0.375, 0);

  // 臉部貼片：貼在頭的 −z 面（頭的半深 0.25 ＋ 浮出量 0.01 → z = −0.26）。
  // PlaneGeometry 預設法線朝 +z → 轉 180° 讓法線朝 −z（yaw=0 的玩家前方）。
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.name = 'face';
  face.position.set(0, 1.75, -(0.25 + FACE_PROTRUDE));
  face.rotation.y = Math.PI;

  // B12：四片盔甲外觀（依裝備切換；位置對齊頭／胸／腿／腳）。
  const armorHelmet = new THREE.Mesh(armorHelmetGeo, armorHelmetMat);
  armorHelmet.name = 'armorHelmet';
  armorHelmet.position.y = 1.75;
  armorHelmet.visible = false;
  const armorChestplate = new THREE.Mesh(armorChestGeo, armorChestMat);
  armorChestplate.name = 'armorChestplate';
  armorChestplate.position.y = 1.3;
  armorChestplate.visible = false;
  const armorLeggings = new THREE.Mesh(armorLeggingsGeo, armorLeggingsMat);
  armorLeggings.name = 'armorLeggings';
  armorLeggings.position.y = 0.55;
  armorLeggings.visible = false;
  const armorBoots = new THREE.Mesh(armorBootsGeo, armorBootsMat);
  armorBoots.name = 'armorBoots';
  armorBoots.position.y = 0.1;
  armorBoots.visible = false;

  group.add(
    head, body, armL, armR, legL, legR, face,
    armorHelmet, armorChestplate, armorLeggings, armorBoots,
  );

  // 與生物模型一致：每個部件都投影（Phase 3 Task 5 的太陽陰影）。
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.castShadow = true;
  });

  scene.add(group);

  return {
    group,
    setPose(feet, yaw) {
      // 非有限值（NaN／±∞）視為 0：避免壞值經過矩陣計算擴散成 NaN 汙染整個場景。
      group.position.set(
        Number.isFinite(feet.x) ? feet.x : 0,
        Number.isFinite(feet.y) ? feet.y : 0,
        Number.isFinite(feet.z) ? feet.z : 0,
      );
      group.rotation.y = Number.isFinite(yaw) ? yaw : 0;
    },
    setVisible(visible) {
      group.visible = visible;
    },
    setArmor(set) {
      const apply = (mesh: THREE.Mesh, stack: ArmorSet[keyof ArmorSet]): void => {
        if (!stack) {
          mesh.visible = false;
          return;
        }
        const material = armorMaterialOf(stack.item);
        if (!material) {
          mesh.visible = false;
          return;
        }
        (mesh.material as THREE.MeshLambertMaterial).color.setHex(ARMOR_COLORS[material]);
        mesh.visible = true;
      };
      apply(armorHelmet, set.helmet);
      apply(armorChestplate, set.chestplate);
      apply(armorLeggings, set.leggings);
      apply(armorBoots, set.boots);
    },
    dispose() {
      scene.remove(group);
      for (const geo of geometries) geo.dispose();
      for (const mat of materials) mat.dispose();
    },
  };
}
