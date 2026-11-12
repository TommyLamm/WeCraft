// B17 Task 9：附魔（`ItemStack.ench`）走完所有堆疊路徑的整合測試。
//
// 這批測試釘住 spec §10 的核心風險：**任何一個堆疊重建點漏掉 `ench`，
// 附魔就會在那一站被無聲洗掉**。涵蓋鏈路：
//   sanitizeStack（存檔清洗）→ InventoryModel（ctor／setSlot／addItem）
//   → 掉落物（spawnDrop／pickup）→ 雲端（build／accept／merge）
//   → 盔甲（normalizeArmorSet）→ 塊實體（箱子 normalize／serialize）。
import { describe, it, expect } from 'vitest';
import { sanitizeStack, INVENTORY_SLOTS, type ItemStack } from './items';
import { createInventoryModel } from './inventory';
import { normalizeArmorSet } from './armor';
import { buildCloudData, acceptCloudData, mergeCloudData, type CloudData } from './cloud-save';
import { spawnDrop, pickup } from '../world/drops';
import { normalizeBlockEntity, serializeBlockEntities } from '../world/block-entities';
import type { Enchantment } from './enchantments';
import { emptyAdvancements } from './advancements';
import { createModeStash } from './mode-stash';
import { createVitals } from '../player/survival';
import type { Settings } from './settings';

// ---- fixtures -------------------------------------------------------------

const efficiency3: Enchantment = { id: 'efficiency', level: 3 };
/** 附魔鑽鎬：合法附魔（efficiency 對鎬相容）＋明確耐久。 */
const enchanted: ItemStack = {
  item: 'diamond_pickaxe',
  count: 1,
  dur: 100,
  ench: efficiency3,
};

/** 36 格寬度的槽位陣列（與 cloud-save 測試同一套 helper 作法）。 */
function slots(...items: Array<ItemStack | null>): Array<ItemStack | null> {
  return [...items, ...new Array(INVENTORY_SLOTS - items.length).fill(null)];
}

function settings(): Settings {
  return {
    seed: 1337,
    renderDistance: 10,
    sensitivity: 1,
    volume: 0.8,
    mode: 'survival',
    dayLengthSec: 600,
    shadows: true,
    clouds: true,
  };
}

/** 一份完整、合法的 CloudData（mergeCloudData 的輸入形狀）。 */
function mkCloudData(over: Partial<CloudData> = {}): CloudData {
  return {
    seed: 1337,
    pos: [0, 64, 0],
    yaw: 0,
    vitals: createVitals(),
    clockT: 0,
    inventory: slots(null),
    advancements: emptyAdvancements(),
    settings: settings(),
    stash: createModeStash(),
    passiveMobs: [],
    blockEntities: [],
    spawnPoint: null,
    armor: normalizeArmorSet(null),
    xp: { level: 0, xp: 0 },
    ...over,
  };
}

/** buildCloudData 的最小合法來源。 */
function buildSource(inventory: Array<ItemStack | null>) {
  return {
    seed: 42,
    pos: [10, 65, -7] as [number, number, number],
    yaw: 0.5,
    vitals: createVitals(),
    clockT: 99,
    inventory,
    advancements: emptyAdvancements(),
    settings: settings(),
    stash: createModeStash(),
    passiveMobs: [],
    blockEntities: [],
    spawnPoint: null,
  };
}

describe('ench persistence（B17 Task 9）', () => {
  it('sanitizeStack keeps a legal enchant and drops junk', () => {
    expect(sanitizeStack(enchanted)).toEqual(enchanted);
    // 未知 id → 丟棄（鍵整個消失，不是 ench: undefined）
    expect(sanitizeStack({ ...enchanted, ench: { id: 'nope', level: 1 } })!.ench).toBeUndefined();
    // 不相容（sharpness 只對劍／斧合法，鎖不上鎬）→ 丟棄
    expect(sanitizeStack({ ...enchanted, ench: { id: 'sharpness', level: 1 } })!.ench)
      .toBeUndefined();
    // 非附魔物品帶著附魔 → 丟棄（附魔欄位只出現在合法物品上）
    expect(
      sanitizeStack({ item: 'dirt', count: 1, ench: efficiency3 })!.ench,
    ).toBeUndefined();
  });

  it('the inventory model keeps ench through ctor, setSlot and addItem', () => {
    // ctor：初始槽位保留附魔
    const model = createInventoryModel(slots(enchanted), 'survival');
    expect(model.slots[0]).toEqual(enchanted);

    // setSlot：寫入保留附魔；垃圾附魔被模型丟棄
    model.setSlot(1, enchanted);
    expect(model.slots[1]).toEqual(enchanted);
    model.setSlot(2, { ...enchanted, ench: { id: 'sharpness', level: 1 } });
    expect(model.slots[2]).toEqual({ item: 'diamond_pickaxe', count: 1, dur: 100 });

    // addItem：第 4 參數 ench 一起落地
    const fresh = createInventoryModel(new Array(36).fill(null), 'survival');
    expect(fresh.addItem('diamond_pickaxe', 1, 100, efficiency3)).toBe(0);
    expect(fresh.slots[0]).toEqual(enchanted);
    // 附魔工具（堆疊上限 1）永不合併：再丟一把 → 另一格、各自帶著附魔
    expect(fresh.addItem('diamond_pickaxe', 1, 200, efficiency3)).toBe(0);
    expect(fresh.slots[1]).toEqual({ item: 'diamond_pickaxe', count: 1, dur: 200, ench: efficiency3 });
    expect(fresh.slots[0]).toEqual(enchanted);
  });

  it('an enchanted stack survives a drop spawn/pickup round-trip', () => {
    let drops = spawnDrop([], 'diamond_pickaxe', 1, { x: 0, y: 0, z: 0 }, {
      dur: 100,
      ench: enchanted.ench,
    });
    const model = createInventoryModel(new Array(36).fill(null), 'survival');
    const out = pickup(drops, 0, model);
    expect(model.slots[0]).toMatchObject({
      item: 'diamond_pickaxe',
      dur: 100,
      ench: efficiency3,
    });
    expect(out.drops).toHaveLength(0);
    // 沒帶 ench 的掉落物不長出這個鍵
    drops = spawnDrop([], 'stone', 3, { x: 0, y: 0, z: 0 }, {});
    expect('ench' in drops[0]).toBe(false);
  });

  it('cloud build/accept/merge keep ench', () => {
    // build：寫出的 payload 帶著附魔
    const built = buildCloudData(buildSource(slots(enchanted)));
    expect(built.inventory[0]).toEqual(enchanted);

    // accept：往返 JSON 之後照樣讀回（模擬真正的雲端傳輸）
    const accepted = acceptCloudData(JSON.parse(JSON.stringify(built)))!;
    expect(accepted).not.toBeNull();
    expect(accepted.inventory[0]).toEqual(enchanted);

    // merge：本機沒有 diamond_pickaxe → 遠端那把附魔鎬整把補進來（附魔跟著走）
    const merged = mergeCloudData(mkCloudData(), accepted);
    const pickaxe = merged.inventory.find((s) => s?.item === 'diamond_pickaxe');
    expect(pickaxe).toEqual(enchanted);
  });

  it('armor normalization keeps protection on the right slot', () => {
    const set = normalizeArmorSet({
      helmet: {
        item: 'iron_helmet',
        count: 1,
        dur: 100,
        ench: { id: 'protection', level: 2 },
      },
      // efficiency 對盔甲不合法 → 附魔被丟棄，頭盔本體照收
      chestplate: {
        item: 'iron_chestplate',
        count: 1,
        dur: 200,
        ench: efficiency3,
      },
      // 錯誤部位 → 整格丟棄
      boots: { item: 'iron_helmet', count: 1, dur: 165 },
    });
    expect(set.helmet).toEqual({
      item: 'iron_helmet',
      count: 1,
      dur: 100,
      ench: { id: 'protection', level: 2 },
    });
    expect(set.chestplate).toEqual({ item: 'iron_chestplate', count: 1, dur: 200 });
    expect(set.boots).toBeNull();
    expect(set.leggings).toBeNull();
  });

  it('a chest keeps ench through normalizeBlockEntity and serializeBlockEntities', () => {
    const entity = normalizeBlockEntity({
      kind: 'chest',
      x: 1,
      y: 2,
      z: 3,
      slots: [enchanted, null],
    })!;
    expect(entity.slots![0]).toEqual(enchanted);
    // serialize（存檔寫出）一起帶走
    const serialized = serializeBlockEntities([entity]);
    expect(serialized[0].slots![0]).toEqual(enchanted);
  });
});
