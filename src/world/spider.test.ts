import { describe, it, expect } from 'vitest';
import {
  SPIDER_ATTACK_DAMAGE,
  SPIDER_CHASE_SPEED,
  SPIDER_CLIMB_SPEED,
  SPIDER_HEIGHT,
  SPIDER_HP,
  SPIDER_HOSTILE_LIGHT_MAX,
  SPIDER_MAX_CLIMB,
  SPIDER_WIDTH,
  attackSpider,
  createSpider,
  damageSpider,
  hitSpiderId,
  isSpiderDead,
  spiderAggression,
  stepSpider,
  type Spider,
  type SpiderCtx,
  type SpiderEvent,
} from './spider';
import type { SpawnLight } from './spawn-rules';

// ---- helpers -------------------------------------------------------------
const lightAt = (internalSky: number, block = 0): SpawnLight => ({
  sky: 15,
  internalSky,
  block,
  lit: true,
});
const DARK = lightAt(0);
const DAY = lightAt(15);

const ctxFor = (
  playerPos: { x: number; y: number; z: number },
  opts: {
    dt?: number;
    light?: SpawnLight;
    solid?: (x: number, y: number, z: number) => boolean;
    los?: boolean;
    rng?: () => number;
  } = {},
): SpiderCtx => ({
  playerPos,
  isSolidAt: opts.solid ?? (() => false),
  hasLineOfSight: () => opts.los ?? true,
  lightAt: () => opts.light ?? DARK,
  dt: opts.dt ?? 0.05,
  rng: opts.rng,
});

/** 步進 n 步（預設 dt 0.05）→ 回傳最後的蜘蛛與所有事件。 */
const run = (
  s: Spider,
  ctx: SpiderCtx,
  steps: number,
): { spider: Spider; events: SpiderEvent[] } => {
  let cur = s;
  const events: SpiderEvent[] = [];
  for (let i = 0; i < steps; i++) {
    const r = stepSpider(cur, ctx);
    cur = r.spider;
    events.push(...r.events);
  }
  return { spider: cur, events };
};

/** 假世界（攀牆案例共用）：地面 y ≤ 5 實心；x ≥ 3 的高台從 y = 6 到 wallTop
 *  連續實心（頂面 = wallTop + 1）。
 *  為什麼是「高台」而不是單一根柱子：蜘蛛登頂後會繼續追玩家，單柱的頂面只有
 *  一格寬，牠會在 2 秒內走過頭掉下去 → 「2 秒後 pos.y 正好等於頂面」這條斷言
 *  會變成在測「掉下去的相位」而不是「爬得上去」。高台讓牠登頂後站得住。 */
const plateau = (wallTop: number) => ({
  isSolidAt: (x: number, y: number, _z: number): boolean =>
    y <= 5 || (x >= 3 && y >= 6 && y <= wallTop),
});

describe('spider (B9 Task 6)', () => {
  it('the spider table matches the vanilla stats', () => {
    expect(SPIDER_HP).toBe(16);
    expect(SPIDER_WIDTH).toBe(1.4);
    expect(SPIDER_HEIGHT).toBe(0.9);
    expect(SPIDER_CHASE_SPEED).toBe(4.0);
    expect(SPIDER_ATTACK_DAMAGE).toBe(2);
    expect(SPIDER_HOSTILE_LIGHT_MAX).toBe(11);
    expect(SPIDER_MAX_CLIMB).toBe(3);
    expect(SPIDER_CLIMB_SPEED).toBe(2.0);
  });

  it('the aggression threshold is the vanilla light level 11', () => {
    // 原版：亮度 ≤ 11 → 敵對；≥ 12 → 中立。吃的是**內部**天空光（夜晚會下降），
    // 不是客戶端天空光（永遠 15）。
    expect(spiderAggression({ sky: 15, internalSky: 4, block: 0, lit: true })).toBe('hostile'); // 夜晚地表
    expect(spiderAggression({ sky: 15, internalSky: 15, block: 0, lit: true })).toBe('neutral'); // 白天地表
    expect(spiderAggression({ sky: 0, internalSky: 0, block: 13, lit: true })).toBe('neutral'); // 火把旁
    expect(spiderAggression({ sky: 0, internalSky: 0, block: 0, lit: true })).toBe('hostile'); // 洞穴
    expect(spiderAggression({ sky: 0, internalSky: 11, block: 0, lit: true })).toBe('hostile');
    expect(spiderAggression({ sky: 0, internalSky: 12, block: 0, lit: true })).toBe('neutral');
    // B6／B3 公約：**未知不是暗**——區塊還沒點光（lit:false）時三個數值都是 0，
    // 若照數值讀會是「全黑 → 敵對」＝白天的蜘蛛也會撲人 → 一律當中立。
    expect(spiderAggression({ sky: 0, internalSky: 0, block: 0, lit: false })).toBe('neutral');
  });

  it('a spider in daylight does not chase the player', () => {
    // rng 0.75 → wanderDir = 3π/2（-x，背向玩家）
    const s = createSpider({ x: 0, y: 6, z: 0.5 }, () => 0.75);
    const ctx = ctxFor({ x: 5, y: 6, z: 0.5 }, { light: DAY });
    const before = 5;
    const r = run(s, ctx, 20); // 1 秒
    expect(r.spider.state).toBe('wander');
    expect(Math.hypot(5 - r.spider.pos.x, 0.5 - r.spider.pos.z)).toBeGreaterThanOrEqual(before);
  });

  it('a spider in the dark chases the player', () => {
    const s = createSpider({ x: 0, y: 6, z: 0.5 }, () => 0.5);
    const ctx = ctxFor({ x: 8, y: 6, z: 0.5 }, { light: DARK });
    const before = 8;
    const r = run(s, ctx, 10); // 0.5 秒
    expect(r.spider.state).toBe('chase');
    expect(Math.hypot(8 - r.spider.pos.x, 0.5 - r.spider.pos.z)).toBeLessThan(before);
  });

  it('a spider keeps chasing after being hit even in daylight', () => {
    const s = createSpider({ x: 0, y: 6, z: 0.5 }, () => 0.5);
    const hit = damageSpider(s, 1);
    expect(hit.angry).toBe(true);
    expect(hit.hp).toBe(SPIDER_HP - 1);
    // B9 修正：**只有玩家（近戰）會激怒蜘蛛**——爆炸不是玩家攻擊。
    // `damageSpider` 的第四個參數 `{ angry: false }` 給爆炸路徑用（預設 true＝既有行為）。
    expect(damageSpider(s, 1, undefined, { angry: false }).angry).toBe(false);
    const r = stepSpider(hit, ctxFor({ x: 5, y: 6, z: 0.5 }, { light: DAY }));
    expect(r.spider.state).toBe('chase');
  });

  it('a spider bites the player in reach', () => {
    const s = createSpider({ x: 0, y: 6, z: 0.5 }, () => 0.5);
    const ctx = ctxFor({ x: 1, y: 6, z: 0.5 }, { light: DARK, dt: 0.1 });
    const first = stepSpider(s, ctx);
    expect(first.events).toEqual([
      { type: 'damage', target: 'player', amount: SPIDER_ATTACK_DAMAGE, spiderId: s.id },
    ]);
    // 冷卻 1 秒：再過 0.5 秒仍然不會咬
    let cur = first.spider;
    const events: SpiderEvent[] = [];
    for (let i = 0; i < 5; i++) {
      const r = stepSpider(cur, ctx);
      cur = r.spider;
      events.push(...r.events);
    }
    expect(events).toHaveLength(0);
  });

  it('a spider does not bite through a wall', () => {
    const s = createSpider({ x: 0, y: 6, z: 0.5 }, () => 0.5);
    const ctx = ctxFor({ x: 1, y: 6, z: 0.5 }, { light: DARK, los: false, dt: 0.1 });
    const r = run(s, ctx, 10);
    expect(r.events).toHaveLength(0);
  });

  // ---- 攀牆（見計畫〈已查證與設計決策〉§6）----

  it('a spider climbs a two-block wall while chasing', () => {
    const s = createSpider({ x: 2.5, y: 6, z: 0.5 }, () => 0.5);
    const world = plateau(7); // 頂面 y = 8
    const ctx = ctxFor({ x: 6, y: 8, z: 0.5 }, { light: DARK, solid: world.isSolidAt });
    const r = run(s, ctx, 40); // 2 秒
    expect(r.spider.state).toBe('chase');
    expect(r.spider.pos.y).toBe(8); // 腳底正好在牆頂面
  });

  it('a spider climbs a three-block wall while chasing', () => {
    const s = createSpider({ x: 2.5, y: 6, z: 0.5 }, () => 0.5);
    const world = plateau(8); // 頂面 y = 9
    const ctx = ctxFor({ x: 6, y: 9, z: 0.5 }, { light: DARK, solid: world.isSolidAt });
    const r = run(s, ctx, 60); // 3 秒
    expect(r.spider.state).toBe('chase');
    expect(r.spider.pos.y).toBe(9);
  });

  it('a spider does not climb a wall taller than three blocks', () => {
    const s = createSpider({ x: 2.5, y: 6, z: 0.5 }, () => 0.5);
    const world = plateau(9); // 頂面 y = 10，障礙高 4 > SPIDER_MAX_CLIMB
    const ctx = ctxFor({ x: 6, y: 10, z: 0.5 }, { light: DARK, solid: world.isSolidAt });
    const r = run(s, ctx, 60); // 3 秒
    expect(r.spider.state).toBe('chase');
    expect(r.spider.pos.y).toBe(6); // 完全沒上升（連跳都沒有）
    expect(r.spider.climbHeight).toBe(0);
  });

  it('a wandering spider does not climb', () => {
    // rng 0.25 → wanderDir = π/2（+x，正對高台）
    const s = createSpider({ x: 2.5, y: 6, z: 0.5 }, () => 0.25);
    const world = plateau(7);
    const ctx = ctxFor({ x: 40, y: 8, z: 0.5 }, { light: DARK, solid: world.isSolidAt });
    const r = run(s, ctx, 40); // 2 秒
    expect(r.spider.state).toBe('wander');
    expect(r.spider.pos.y).toBe(6);
    expect(r.spider.climbHeight).toBe(0);
  });

  it('a damaged spider has less hp', () => {
    const s = createSpider({ x: 0, y: 6, z: 0 }, () => 0.5);
    expect(damageSpider(s, 4).hp).toBe(SPIDER_HP - 4);
    // 非有限／非正傷害是 no-op
    expect(damageSpider(s, -1).hp).toBe(SPIDER_HP);
    expect(damageSpider(s, NaN).hp).toBe(SPIDER_HP);
    expect(isSpiderDead(damageSpider(s, 999))).toBe(true);
    expect(isSpiderDead(s)).toBe(false);
  });

  it('the crosshair hits a spider', () => {
    const s = createSpider({ x: 0, y: 0, z: 0 }, () => 0.5);
    // 蜘蛛只有 0.9 高 → 射線高度要在碰撞盒內
    expect(hitSpiderId([s], { x: 0, y: 0.45, z: 5 }, { x: 0, y: 0, z: -1 }, 10)).toBe(s.id);
    expect(hitSpiderId([s], { x: 0, y: 2, z: 5 }, { x: 0, y: 0, z: -1 }, 10)).toBeNull();
    expect(hitSpiderId([s], { x: 0, y: 0.45, z: 5 }, { x: 0, y: 0, z: -1 }, 1)).toBeNull();
  });

  it('attacking reduces hp and reports the hit', () => {
    const s = createSpider({ x: 0, y: 0, z: 0 }, () => 0.5);
    const r = attackSpider([s], { x: 0, y: 0.45, z: 5 }, { x: 0, y: 0, z: -1 }, 10, 5, {
      x: 0,
      z: -1,
    });
    expect(r.hitId).toBe(s.id);
    expect(r.spiders[0].hp).toBe(SPIDER_HP - 5);
    expect(r.spiders[0].angry).toBe(true);
    const miss = attackSpider([s], { x: 0, y: 2, z: 5 }, { x: 0, y: 0, z: -1 }, 10, 5, {
      x: 0,
      z: -1,
    });
    expect(miss.hitId).toBeNull();
    expect(miss.spiders[0].hp).toBe(SPIDER_HP);
  });

  it('non-finite dt is treated as zero', () => {
    const s = createSpider({ x: 2.5, y: 6, z: 0.5 }, () => 0.5);
    const ctx = ctxFor({ x: 10, y: 6, z: 0.5 }, { dt: NaN });
    const r = stepSpider(s, ctx);
    expect(r.spider.pos).toEqual(s.pos);
    expect(Number.isFinite(r.spider.pos.x)).toBe(true);
    expect(Number.isFinite(r.spider.pos.y)).toBe(true);
  });
});
