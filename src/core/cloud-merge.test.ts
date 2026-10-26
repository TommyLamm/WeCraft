// C1 合併（merge）語意測試。
//
// 409 後玩家可以選「合併」：把雲端獨有的東西補進本機，但**絕不刪除**本機
// 任何一側的成果，也絕不複製雙方都有的物品。世界情境（seed／位置／時間／
// 設定）一律用本機——玩家正站在那個世界裡。
import { describe, it, expect } from 'vitest';
import { CLOUD_MAX_BYTES, byteSizeOf, mergeCloudData, type CloudData } from './cloud-save';
import { createVitals } from '../player/survival';
import { INVENTORY_SLOTS, starterSlots, type ItemId, type ItemStack } from './items';
import { emptyAdvancements } from './advancements';
import type { Settings } from './settings';
import { WORLDGEN_VERSION } from '../world/worldgen';
import type { PassiveMobRecord } from '../world/passive-save';

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

function slots(...items: Array<ItemStack | null>): Array<ItemStack | null> {
  return [...items, ...new Array(INVENTORY_SLOTS - items.length).fill(null)];
}

/** A full, valid CloudData (the shape acceptCloudData/buildCloudData produce). */
function mkData(over: Partial<CloudData> = {}): CloudData {
  return {
    seed: 1337,
    pos: [0, 64, 0],
    yaw: 0,
    vitals: createVitals(),
    clockT: 0,
    inventory: starterSlots('survival'),
    advancements: emptyAdvancements(),
    settings: { ...settings() },
    stash: {
      survival: starterSlots('survival'),
      creative: starterSlots('creative'),
      survivalVitals: createVitals(),
    },
    worldgenVersion: WORLDGEN_VERSION,
    passiveMobs: [],
    ...over,
  };
}

function totalOf(d: CloudData, item: ItemId): number {
  let n = 0;
  for (const s of d.inventory) if (s && s.item === item) n += s.count;
  return n;
}

describe('mergeCloudData (C1 合併)', () => {
  it('keeps every local slot and adds remote-only items', () => {
    const local = mkData({
      inventory: slots({ item: 'dirt', count: 10 }, { item: 'oak_log', count: 3 }, null),
    });
    const remote = mkData({ inventory: slots({ item: 'diamond_ore', count: 5 }) });

    const merged = mergeCloudData(local, remote);

    expect(totalOf(merged, 'dirt')).toBe(10);
    expect(totalOf(merged, 'oak_log')).toBe(3);
    expect(totalOf(merged, 'diamond_ore')).toBe(5);
  });

  it('never duplicates an item both sides already have', () => {
    const local = mkData({ inventory: slots({ item: 'dirt', count: 10 }) });
    const remote = mkData({
      inventory: slots({ item: 'dirt', count: 3 }, { item: 'stone', count: 5 }),
    });

    const merged = mergeCloudData(local, remote);

    // dirt is NOT local-count-0 → the remote's copy is deliberately skipped
    // (merging must never multiply what the player already owns).
    expect(totalOf(merged, 'dirt')).toBe(10);
    expect(totalOf(merged, 'stone')).toBe(5);
  });

  it('keeps the local position, yaw, clock and world context', () => {
    const local = mkData({ pos: [12.5, 70, -4.25], yaw: 1.75, clockT: 999, seed: 4242 });
    const remote = mkData({
      pos: [-100, 30, 500],
      yaw: -3,
      clockT: 111,
      seed: 777,
      worldgenVersion: 99,
    });

    const merged = mergeCloudData(local, remote);

    expect(merged.pos).toEqual([12.5, 70, -4.25]);
    expect(merged.yaw).toBe(1.75);
    expect(merged.clockT).toBe(999);
    // The merged payload describes the world the LOCAL player is standing in —
    // adopting the remote's seed would yank the ground out from under them.
    expect(merged.seed).toBe(4242);
    expect(merged.worldgenVersion).toBe(WORLDGEN_VERSION);
    expect(merged.settings.renderDistance).toBe(local.settings.renderDistance);
  });

  it('unions advancements from both sides', () => {
    const local = mkData({
      advancements: { done: { getting_wood: true }, nightSeen: false },
    });
    const remote = mkData({
      advancements: { done: { first_night: true }, nightSeen: true },
    });

    const merged = mergeCloudData(local, remote);

    expect(merged.advancements.done.getting_wood).toBe(true);
    expect(merged.advancements.done.first_night).toBe(true);
    expect(merged.advancements.nightSeen).toBe(true);
  });

  it('keeps durable stacks intact (a damaged tool is not repaired or merged)', () => {
    const local = mkData({ inventory: slots(null) });
    const remote = mkData({
      inventory: slots({ item: 'iron_pickaxe', count: 1, dur: 17 }),
    });

    const merged = mergeCloudData(local, remote);

    const kept = merged.inventory.filter((s) => s && s.item === 'iron_pickaxe');
    expect(kept).toHaveLength(1);
    expect(kept[0]).toEqual({ item: 'iron_pickaxe', count: 1, dur: 17 });
  });

  it('drops a remote-only item that does not fit rather than dropping local items', () => {
    const full = Array.from({ length: INVENTORY_SLOTS }, () => ({
      item: 'dirt' as const,
      count: 64,
    }));
    const local = mkData({ inventory: full });
    const remote = mkData({ inventory: slots({ item: 'diamond_ore', count: 5 }) });

    const merged = mergeCloudData(local, remote);

    expect(totalOf(merged, 'dirt')).toBe(INVENTORY_SLOTS * 64); // nothing local was touched
    expect(totalOf(merged, 'diamond_ore')).toBe(0); // no room → the id is dropped whole
  });

  it('never returns a payload over the 64 KiB cap (extra cloud items are shed first)', () => {
    // A local base sitting just under the cap: the ONLY thing the merge may
    // discard is what the cloud added — never the local progress.
    const local = mkData();
    const mobs: PassiveMobRecord[] = [];
    while (byteSizeOf({ ...local, passiveMobs: mobs }) < CLOUD_MAX_BYTES - 900) {
      mobs.push({ kind: 'cow', x: mobs.length + 0.5, y: 64, z: -mobs.length - 0.25, hp: 10, yaw: 0.5 });
    }
    local.passiveMobs = mobs;
    const localSize = byteSizeOf(local);
    expect(localSize).toBeLessThan(CLOUD_MAX_BYTES);

    // 36 remote-only item ids that would each add a stack → over the cap.
    const remoteIds: ItemId[] = [
      'stone', 'cobblestone', 'sand', 'glass', 'gravel', 'wool', 'ice', 'torch',
      'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'spruce_log', 'birch_log',
      'oak_planks', 'spruce_planks', 'birch_planks', 'oak_leaves', 'spruce_leaves',
      'birch_leaves', 'cactus', 'dandelion', 'poppy', 'short_grass', 'snow_block',
      'crafting_table', 'furnace', 'bedrock', 'grass', 'wool', 'stone', 'sand',
      'glass', 'gravel', 'ice', 'torch',
    ];
    const remoteInv: Array<ItemStack | null> = starterSlots('survival');
    for (let i = 0; i < remoteIds.length && i < remoteInv.length; i++) {
      remoteInv[i] = { item: remoteIds[i], count: 64 };
    }
    const remote = mkData({ inventory: remoteInv });

    const merged = mergeCloudData(local, remote);

    expect(byteSizeOf(merged)).toBeLessThanOrEqual(CLOUD_MAX_BYTES);
    expect(merged.passiveMobs).toHaveLength(mobs.length); // local progress untouched
    // The back-off actually ran: some remote-only ids made it, some were shed
    // (shedding starts from the LAST one added, so the first id survives).
    const kept = merged.inventory.filter((s) => s !== null).length;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(remoteIds.length);
  });
});
