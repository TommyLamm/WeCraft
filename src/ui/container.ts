import './ui.css';
import { HOTBAR_SLOTS, MAIN_SLOTS, stackName, type ItemStack } from '../core/items';
import { ICON_PX, getContext2d, itemIcon } from './icons';
import { cursorLeftClick, cursorRightClick } from './cursor';

// ---- 容器面板（B8 Task 3）----
//
// 單箱 27 格 ＋ 玩家 36 格（主背包 27 ＋ 熱鍵列 9），沿用 B5 背包的游標堆疊
// 模型：左鍵整疊／右鍵一半。面板**不持有任何格子副本**——`container`／
// `inventory` 對 UI 是唯讀的，每次變動都只透過 `onContainerChange`／
// `onInventoryChange` 回報，由擁有者（main.ts）寫回活陣列。
//
// 游標是面板自己的狀態；`close()` 交給 `onReturnCursor`，三態語意：
//   undefined ＝ 沒有回呼／無法判定 → 留在游標上（下次 open 還看得到）
//   null      ＝ 已全數放回          → 游標清空
//   ItemStack ＝ 放不下的餘量        → 保留這一份
// **禁用 `??`**：它會把「回傳 null＝已放回」誤判成「沒有回傳」→ 每次開關都複製物品。

export interface ContainerParams {
  /** 面板標題（'箱子'）。 */
  title: string;
  /** 容器的 27 格（唯讀給 UI；變動一律走 `onContainerChange`）。 */
  container: ReadonlyArray<ItemStack | null>;
  /** 玩家的 36 格背包（唯讀給 UI；變動一律走 `onInventoryChange`）。 */
  inventory: ReadonlyArray<ItemStack | null>;
  /** 容器格被改動（index 0..26）。 */
  onContainerChange(index: number, stack: ItemStack | null): void;
  /** 玩家背包格被改動（index 0..35；前 9 格是熱鍵列）。 */
  onInventoryChange(index: number, stack: ItemStack | null): void;
  /** 關閉面板時歸還游標堆疊；回傳值語意見檔頭的三態表。 */
  onReturnCursor?(stack: ItemStack): ItemStack | null | undefined;
  /** 面板被關閉（背景點擊／Esc／E）。 */
  onClose?(): void;
}

export interface ContainerUi {
  open(params: ContainerParams): void;
  close(): void;
  /** B8（review fix #2）：把游標上的堆疊再交一次給擁有者（`onReturnCursor`）——
   *  **關著面板也適用**（回呼跟著擁有者記住），放不下的餘量**原地**留在游標上。
   *  `sessionSavePayload` 在快照前**無條件**呼叫：容器游標是 UI 擁有的狀態、
   *  **不在 payload 裡**，不沖刷就是掉料（與合成格的 A4 沖刷同型）。 */
  flushCursor(): void;
  /** 取出剩下的游標堆疊並**清空**（session 邊界：不得活到下一場次）。 */
  returnCursor(): ItemStack | null;
  isOpen(): boolean;
}

const CONTAINER_SLOTS = 27;

function validStack(s: ItemStack | null | undefined): s is ItemStack {
  return !!s && Number.isFinite(s.count) && s.count >= 1;
}

/** Copy a stack into a slot element (own canvas — `itemIcon` caches ONE canvas
 *  per item, which cannot sit in several cells at once; mirrors ui/furnace.ts). */
function fillSlot(slot: HTMLElement, stack: ItemStack | null): void {
  slot.replaceChildren();
  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = getContext2d(canvas);
  if (ctx && stack) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(itemIcon(stack.item), 0, 0);
  } // jsdom has no 2d context: empty canvas, title/count still assertable
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = stack && stack.count > 1 ? String(stack.count) : '';
  slot.append(canvas, count);
  slot.title = stack ? stackName(stack.item) : '';
}

export function createContainer(uiRoot: HTMLElement): ContainerUi {
  let el: HTMLElement | null = null;
  let escHandler: ((e: KeyboardEvent) => void) | null = null;
  let cursor: ItemStack | null = null;
  // `opts` 必須存進閉包：`open()` 開頭會先 `close()`，上一次沒放回來的游標
  // 要用「上一次開啟」的 onReturnCursor 交還。
  let opts: ContainerParams | undefined;
  // B8（review fix #2）：擁有者的歸還回呼**跨 close 保留**——面板關著、餘量還
  // 停在游標上時，存檔的無條件沖刷仍要找得到同一個擁有者（`flushCursor`）。
  let lastReturnCb: ContainerParams['onReturnCursor'];
  let params: ContainerParams | undefined;
  let containerEls: HTMLElement[] = [];
  let mainEls: HTMLElement[] = [];
  let barEls: HTMLElement[] = [];
  let cursorEl: HTMLElement | null = null;
  let hoverEl: HTMLElement | null = null;

  const stackAt = (
    slots: ReadonlyArray<ItemStack | null>,
    index: number,
  ): ItemStack | null => {
    const s = slots[index];
    return validStack(s) ? s : null;
  };

  const paintSlot = (node: HTMLElement, stack: ItemStack | null | undefined): void => {
    fillSlot(node, validStack(stack) ? { ...stack } : null);
  };

  const renderCursor = (): void => {
    if (!cursor) {
      cursorEl?.remove();
      cursorEl = null;
      return;
    }
    if (!cursorEl) {
      cursorEl = document.createElement('div');
      cursorEl.className = 'ui-cursor-stack';
      // 開出不前先藏在可視範圍外（等第一次 mousemove 才跟到指標上）
      cursorEl.style.left = '-100px';
      cursorEl.style.top = '-100px';
    }
    fillSlot(cursorEl, { ...cursor });
    el?.querySelector('.ui-container')?.appendChild(cursorEl);
  };

  const render = (): void => {
    const p = params;
    if (!p) return;
    containerEls.forEach((node, i) => paintSlot(node, stackAt(p.container, i)));
    mainEls.forEach((node, i) => paintSlot(node, stackAt(p.inventory, HOTBAR_SLOTS + i)));
    barEls.forEach((node, i) => paintSlot(node, stackAt(p.inventory, i)));
    renderCursor();
  };

  const applyClick = (index: number, inContainer: boolean, right: boolean): void => {
    if (!params) return;
    const target = inContainer
      ? stackAt(params.container, index)
      : stackAt(params.inventory, index);
    const res = right ? cursorRightClick(cursor, target) : cursorLeftClick(cursor, target);
    cursor = res.cursor;
    if (inContainer) params.onContainerChange(index, res.target);
    else params.onInventoryChange(index, res.target);
    render();
  };

  const onPanelMove = (e: MouseEvent): void => {
    if (cursorEl) {
      cursorEl.style.left = `${e.clientX}px`;
      cursorEl.style.top = `${e.clientY}px`;
    }
    const under = (e.target instanceof Element ? e.target : null)?.closest('.ui-slot');
    if (under !== hoverEl) {
      hoverEl?.classList.remove('ui-cursor-target');
      if (under instanceof HTMLElement) under.classList.add('ui-cursor-target');
      hoverEl = under instanceof HTMLElement ? under : null;
    }
  };

  const onPanelLeave = (): void => {
    hoverEl?.classList.remove('ui-cursor-target');
    hoverEl = null;
  };

  const close = (): void => {
    // 游標歸還三態（禁用 `??`）：undefined → 保留；null → 清空；堆疊 → 保留餘量。
    if (cursor) {
      let remainder: ItemStack | null = cursor; // 沒有回呼 → 留在游標上
      const cb = opts?.onReturnCursor;
      if (cb) {
        const r = cb(cursor);
        remainder = r === undefined ? cursor : r;
      }
      cursor = remainder;
    }
    opts = undefined;
    params = undefined;
    hoverEl?.classList.remove('ui-cursor-target');
    hoverEl = null;
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    cursorEl?.remove();
    cursorEl = null;
    containerEls = [];
    mainEls = [];
    barEls = [];
    el?.remove();
    el = null;
  };

  const open = (p: ContainerParams): void => {
    close(); // 上一次的游標用上一次的 opts 交還（close→open 的交接）
    opts = p;
    params = p;

    lastReturnCb = p.onReturnCursor;

    el = document.createElement('div');
    el.className = 'ui-overlay ui-container-backdrop interactive';
    el.addEventListener('click', (e) => {
      if (e.target !== el) return; // 面板內部的點擊不算關閉
      const cb = params?.onClose;
      close();
      cb?.();
    });
    // Esc／E 都關閉（沿用熔爐面板；此處的 keydown 不受 pointer lock 限制）。
    escHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.code !== 'KeyE') return;
      const cb = params?.onClose;
      close();
      cb?.();
    };
    document.addEventListener('keydown', escHandler);

    const panel = document.createElement('div');
    panel.className = 'ui-container interactive';
    const h = document.createElement('h3');
    h.textContent = p.title;
    panel.appendChild(h);

    const wire = (node: HTMLElement, index: number, inContainer: boolean): void => {
      node.className = 'ui-slot';
      node.addEventListener('click', () => applyClick(index, inContainer, false));
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        applyClick(index, inContainer, true);
      });
    };

    const grid = document.createElement('div');
    grid.className = 'ui-container-grid';
    containerEls = [];
    for (let i = 0; i < CONTAINER_SLOTS; i++) {
      const s = document.createElement('div');
      s.dataset.cslot = String(i);
      wire(s, i, true);
      grid.appendChild(s);
      containerEls.push(s);
    }

    const mainBox = document.createElement('div');
    mainBox.className = 'ui-inv-main';
    mainEls = [];
    for (let i = 0; i < MAIN_SLOTS; i++) {
      const index = HOTBAR_SLOTS + i; // 全域索引：主背包第 i 格 → 9 + i
      const s = document.createElement('div');
      s.dataset.slot = String(index);
      wire(s, index, false);
      mainBox.appendChild(s);
      mainEls.push(s);
    }

    const barBox = document.createElement('div');
    barBox.className = 'ui-inv-bar';
    barEls = [];
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const s = document.createElement('div');
      s.dataset.slot = String(i);
      wire(s, i, false);
      barBox.appendChild(s);
      barEls.push(s);
    }

    panel.append(grid, mainBox, barBox);
    panel.addEventListener('mousemove', onPanelMove);
    panel.addEventListener('mouseleave', onPanelLeave);
    el.appendChild(panel);
    uiRoot.appendChild(el);
    render();
  };

  return {
    open,
    close,
    flushCursor() {
      if (!cursor) return;
      // 關著面板時 `opts` 已被清掉 → 用開啟時記住的同一個擁有者回呼。
      const cb = opts?.onReturnCursor ?? lastReturnCb;
      if (!cb) return;
      const r = cb(cursor);
      cursor = r === undefined ? cursor : r;
      render(); // 開著的面板：重畫格子與游標；關著 → params undefined → no-op
    },
    returnCursor() {
      const leftover = cursor;
      cursor = null;
      cursorEl?.remove();
      cursorEl = null;
      return leftover;
    },
    isOpen: () => el !== null,
  };
}
