import { describe, it, expect, beforeEach } from 'vitest';
import { renderVitals } from './survival-hud';
import { createVitals, damage, starve } from '../player/survival';

/** Icon states ('full' | 'half' | 'empty') in DOM order for a selector. */
function iconStates(selector: string, root: ParentNode): string[] {
  return [...root.querySelectorAll(selector)].map((el) => {
    for (const s of ['full', 'half', 'empty']) if (el.classList.contains(s)) return s;
    return '?'; // icon without a state class — fails the count assertions below
  });
}

/** Distinct fill colors used by the rects of one icon. */
function fills(el: Element): Set<string | null> {
  return new Set([...el.querySelectorAll('rect')].map((r) => r.getAttribute('fill')));
}

/** hp=15 / hunger=15 → half-units 15: elements 0–6 full, 7 half, 8–9 empty. */
const FIFTEEN = ['full', 'full', 'full', 'full', 'full', 'full', 'full', 'half', 'empty', 'empty'];

describe('renderVitals', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.className = 'vitals';
    document.body.appendChild(container);
  });

  it('full vitals: 10 full hearts and 10 full hunger icons', () => {
    renderVitals(container, createVitals());
    expect(iconStates('.heart', container)).toEqual(new Array(10).fill('full'));
    expect(iconStates('.hunger-icon', container)).toEqual(new Array(10).fill('full'));
  });

  it('hp=15 renders 7 full + 1 half + 2 empty hearts (10 elements, left-filled)', () => {
    renderVitals(container, damage(createVitals(), 5)); // hp 15
    const states = iconStates('.heart', container);
    expect(states.length).toBe(10);
    expect(states).toEqual(FIFTEEN);
    expect(iconStates('.hunger-icon', container)).toEqual(new Array(10).fill('full'));
  });

  it('hunger=15 renders 7 full + 1 half + 2 empty drumsticks (10 elements)', () => {
    renderVitals(container, starve(createVitals(), 5)); // hunger 15
    const states = iconStates('.hunger-icon', container);
    expect(states.length).toBe(10);
    expect(states).toEqual(FIFTEEN);
    expect(iconStates('.heart', container)).toEqual(new Array(10).fill('full'));
  });

  it('groups icons under .hearts (left) and .hunger (right)', () => {
    renderVitals(container, createVitals());
    const hearts = container.querySelector('.hearts');
    const hunger = container.querySelector('.hunger');
    expect(hearts).not.toBeNull();
    expect(hunger).not.toBeNull();
    expect([...container.children].map((c) => c.className)).toEqual(['hearts', 'hunger']);
    expect(hearts!.querySelectorAll('.heart').length).toBe(10);
    expect(hunger!.querySelectorAll('.hunger-icon').length).toBe(10);
  });

  it('icons are real SVG pixel art: full uses one fill, half mixes both', () => {
    renderVitals(container, damage(createVitals(), 5)); // hp 15 → one half heart
    const full = container.querySelector('.heart.full')!;
    const half = container.querySelector('.heart.half')!;
    expect(full.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(full.querySelectorAll('rect').length).toBeGreaterThan(10);
    expect(fills(full).size).toBe(1); // every pixel the same color
    expect(fills(half).size).toBe(2); // left half filled, right half empty
  });

  it('renderVitals(el, null) clears the container (creative mode)', () => {
    renderVitals(container, createVitals());
    expect(container.childElementCount).toBeGreaterThan(0);
    renderVitals(container, null);
    expect(container.childElementCount).toBe(0);
    expect(container.childNodes.length).toBe(0);
    renderVitals(container, null); // repeated clear stays empty
    expect(container.childNodes.length).toBe(0);
  });
});
