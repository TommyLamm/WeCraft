import { describe, it, expect } from 'vitest';
import {
  THIRD_PERSON_DISTANCE,
  THIRD_PERSON_HEIGHT_OFFSET,
  VIEW_MODE_ORDER,
  nextViewMode,
  viewPose,
} from './view-mode';

describe('nextViewMode', () => {
  it('the view mode cycles first to back to front to first', () => {
    expect(nextViewMode('first')).toBe('back');
    expect(nextViewMode('back')).toBe('front');
    expect(nextViewMode('front')).toBe('first');
  });

  it('the view mode order is first, back, front', () => {
    expect([...VIEW_MODE_ORDER]).toEqual(['first', 'back', 'front']);
  });
});

describe('viewPose', () => {
  it('the first person pose is the eye with the player angles', () => {
    const eye = { x: 1, y: 2, z: 3 };
    const pose = viewPose('first', eye, 0.5, -0.2);
    expect(pose.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(pose.yaw).toBe(0.5);
    expect(pose.pitch).toBe(-0.2);
  });

  it('the back view places the camera behind the player', () => {
    const eye = { x: 1, y: 2, z: 3 };
    // yaw=0 → 前方＝−z → 面後相機在**後方**＝+z
    const pose = viewPose('back', eye, 0, -0.2);
    expect(pose.pos.z).toBeCloseTo(eye.z + 4);
    expect(pose.pos.x).toBeCloseTo(eye.x);
    expect(pose.pos.y).toBeCloseTo(eye.y + 0.5);
    expect(pose.yaw).toBe(0);
    expect(pose.pitch).toBe(-0.2); // pitch 維持玩家值
  });

  it('the front view places the camera in front and turns it around', () => {
    const eye = { x: 1, y: 2, z: 3 };
    // yaw=0 → 前方＝−z → 面前相機在**前方**＝−z，yaw 反轉 180°
    const pose = viewPose('front', eye, 0, -0.2);
    expect(pose.pos.z).toBeCloseTo(eye.z - 4);
    expect(pose.pos.x).toBeCloseTo(eye.x);
    expect(pose.pos.y).toBeCloseTo(eye.y + 0.5);
    expect(pose.yaw).toBeCloseTo(Math.PI, 10);
    expect(pose.pitch).toBe(-0.2); // pitch 維持玩家值
  });

  it('the camera distance is 4 blocks in both third person modes', () => {
    const eye = { x: 1, y: 2, z: 3 };
    const poseBack = viewPose('back', eye, 0.7, -0.2);
    const poseFront = viewPose('front', eye, 0.7, -0.2);
    expect(Math.hypot(poseBack.pos.x - eye.x, poseBack.pos.z - eye.z)).toBeCloseTo(4, 6);
    expect(Math.hypot(poseFront.pos.x - eye.x, poseFront.pos.z - eye.z)).toBeCloseTo(4, 6);
  });

  it('the third person offset follows the player yaw around the horizontal plane', () => {
    const eye = { x: 0, y: 0, z: 0 };
    // yaw=π/2 → 前方＝−x → 面後相機在 +x，面前相機在 −x
    const back = viewPose('back', eye, Math.PI / 2, 0);
    expect(back.pos.x).toBeCloseTo(4);
    expect(back.pos.z).toBeCloseTo(0);
    const front = viewPose('front', eye, Math.PI / 2, 0);
    expect(front.pos.x).toBeCloseTo(-4);
    expect(front.pos.z).toBeCloseTo(0);
  });

  it('a non-finite input falls back to zero instead of poisoning the camera', () => {
    // yaw 非有限 → 視為 0 → 前方＝−z → 面後相機在 +z 4 格；eye 非有限 → 視為 0
    const pose = viewPose('back', { x: NaN, y: Infinity, z: -Infinity }, NaN, Infinity);
    expect(pose.pos.x).toBe(0);
    expect(pose.pos.y).toBeCloseTo(0.5);
    expect(pose.pos.z).toBeCloseTo(4);
    expect(pose.yaw).toBe(0);
    expect(pose.pitch).toBe(0);
    expect(Number.isFinite(pose.pos.x)).toBe(true);
    expect(Number.isFinite(pose.pos.y)).toBe(true);
    expect(Number.isFinite(pose.pos.z)).toBe(true);
    expect(Number.isFinite(pose.yaw)).toBe(true);
    expect(Number.isFinite(pose.pitch)).toBe(true);
  });

  it('the pose never aliases the eye object', () => {
    const eye = { x: 1, y: 2, z: 3 };
    const pose = viewPose('first', eye, 0, 0);
    expect(pose.pos).not.toBe(eye);
    pose.pos.x = 99;
    expect(eye.x).toBe(1);
  });
});

describe('view mode constants', () => {
  it('pins the third person distance and the height offset', () => {
    expect(THIRD_PERSON_DISTANCE).toBe(4);
    expect(THIRD_PERSON_HEIGHT_OFFSET).toBe(0.5);
  });
});
