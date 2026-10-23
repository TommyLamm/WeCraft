import './ui.css';
import {
  ALL_ITEM_IDS,
  HOTBAR_SLOTS,
  MAIN_SLOTS,
  maxStack,
  stackName,
  type ItemStack,
} from '../core/items';
import type { GameMode } from '../core/inventory';
import { ICON_PX, getContext2d, itemIcon } from './icons';
import { mountCrafting, type CraftingParams } from './crafting';

/** Copy a stack into a slot element (own canvas — `itemIcon` caches ONE canvas
 *  per item, which cannot sit in several cells at once; mirrors crafting's
 *  `fillSlot` and hud's draw). An empty/invalid stack clears the slot. */
function fillSlot(slot: HTMLElement, stack: ItemStack | null): void {
  if (!stack || !Number.isFinite(stack.count) || stack.count < 1) {
    slot.replaceChildren(); // 空格保持空（不放備位 canvas：shared-icon 測試按格數點名）
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = getContext2d(canvas);
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(itemIcon(stack.item), 0, 0);
  } // jsdom has no 2d context: the canvas stays empty (slot/title still assertable)
  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = stack.count > 1 ? String(stack.count) : '';
  slot.replaceChildren(canvas, count);
}

export interface InventoryOpenOptions {
  /** 槽位內容改變 → 擁有者寫回 inventory model 並刷新 HUD。
   *  **面板不持有任何副本**：`slots` 對 UI 是唯讀的，所有變動都只從這裡回報，
   *  UI 自身的游標堆疊另計（`cursor` 只在兩次回報之間持有那「一疊」）。 */
  onSlotChange?(index: number, stack: ItemStack | null): void;
  /** 關閉面板時歸還游標堆疊；回傳值決定游標的下場：
   *  **回傳 `null` ＝ 已全數放回背包**（UI 清掉游標）；
   *  **回傳堆疊 ＝ 放不下的餘量**（UI 保留它，下次開面板時顯示）；
   *  **沒有這個 callback（`undefined`）＝ 沒有擁有者，游標原樣留在 UI 手上**。
   *  **不可用 `??` 判斷**：`??` 只在 null/undefined 時取右側，會把「回傳 null＝
   *  已放回」誤判成「沒有回傳」→ 同一疊同時在游標與背包 → 複製物品。 */
  onReturnCursor?(stack: ItemStack): ItemStack | null;
}

export interface InventoryUi {
  /** 開啟 36 格背包面板：27 格主背包（`slots[9..35]`）＋ 9 格熱鍵列
   *  （`slots[0..8]`）。創造模式額外渲染可捲動的全物品清單
   *  （點一項 → `onPick(selected, 滿堆疊)`）。
   *
   *  `crafting` mounts a 2×2 crafting section into the panel（生存才有；
   *  creative 傳 undefined）— the caller owns no lifecycle beyond passing
   *  params; it is unmounted again in `close()`.
   *
   *  `mode`（B1.2/Task 8）：`'survival'` 走游標堆疊模型、沒有免費清單；
   *  其他值（`'creative'`）保留調色盤清單＋同樣的游標模型。預設 creative，
   *  讓 B1.2 之前的呼叫端（與測試）不用改。 */
  open(
    slots: ReadonlyArray<ItemStack | null>, // 36 格活陣列（唯讀給 UI）
    selected: number, // 遊戲手持的熱鍵欄格 0..8
    onPick: (slot: number, stack: ItemStack) => void,
    onClose?: () => void,
    crafting?: CraftingParams,
    mode?: GameMode,
    options?: InventoryOpenOptions,
  ): void;
  close(): void;
  isOpen(): boolean;
}

export function createInventory(uiRoot: HTMLElement): InventoryUi {
  let el: HTMLElement | null = null;
  let escHandler: ((e: KeyboardEvent) => void) | null = null;
  let unmountCrafting: (() => void) | null = null;
  // 游標堆疊（點擊選取→點擊放置）存在閉包裡：close 時交還擁有者、
  // 放不下時留在這裡跨 open 顯示。
  let cursor: ItemStack | null = null;
  // `opts` 必須存進閉包：`open()` 開頭的 `this.close()` 沒有參數在手，
  // 上一次沒放回來的游標要用「上一次開啟」的 opts 交還。
  let opts: InventoryOpenOptions | undefined;
  // ↓ 以下都是「這一次 open」的渲染狀態（open/close 時重置）
  let slotsView: ReadonlyArray<ItemStack | null> = [];
  let onPick: (slot: number, stack: ItemStack) => void = () => {};
  let selected = 0;
  let survival = true;
  let barEls: HTMLElement[] = [];
  let mainEls: HTMLElement[] = [];
  let cursorEl: HTMLElement | null = null;
  let hoverEl: HTMLElement | null = null;

  const valid = (s: ItemStack | null | undefined): s is ItemStack =>
    !!s && Number.isFinite(s.count) && s.count >= 1;

  const slotStack = (index: number): ItemStack | null => {
    const s = slotsView[index]; // 越界 → undefined → 一律當空格
    return valid(s) ? s : null;
  };

  const emitChange = (index: number, stack: ItemStack | null): void => {
    opts?.onSlotChange?.(index, stack);
  };

  /** 重繪一格（沿用持久節點，靠 replaceChildren 換內容——shared-icon 迴歸
   *  測試依賴「每格自己剛生出來的 canvas」，重繪也不能共用到別格去）。 */
  const paintSlot = (node: HTMLElement, stack: ItemStack | null | undefined): void => {
    fillSlot(node, valid(stack) ? { ...stack } : null); // copies：不讓 UI 持有模型的堆疊
    node.title = valid(stack) ? stackName(stack.item) : '';
  };

  /** 重繪 36 格 + 游標（清單是靜態的 item 種類清單，不必跟著槽位重畫）。 */
  const render = (): void => {
    barEls.forEach((node, i) => paintSlot(node, slotsView[i])); // 0..8 熱鍵列
    mainEls.forEach((node, i) => paintSlot(node, slotsView[HOTBAR_SLOTS + i])); // 9..35 主背包
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
    cursorEl.title = stackName(cursor.item);
    fillSlot(cursorEl, { ...cursor }); // own canvas copy：與底下格子同物品也不共用節點
    if (el) el.querySelector('.ui-inventory')?.appendChild(cursorEl);
  };

  // ---- 游標堆疊模型（brief Step 3，原版點擊語義） ----

  /** 左鍵：游標空 → 整疊拿上來（格子清空）；游標有貨 → 目標有東西就交換、
   *  目標空就放下。只透過 onSlotChange 回報，UI 自己不碰 slotsView。 */
  const leftClickSlot = (index: number): void => {
    const target = slotStack(index);
    if (!cursor) {
      if (!target) return; // 空手點空格 → 無事發生
      cursor = { ...target };
      emitChange(index, null);
    } else if (target) {
      const taken = { ...target }; // 換下來的那疊上到游標
      emitChange(index, cursor);
      cursor = taken;
    } else {
      emitChange(index, cursor);
      cursor = null;
    }
    render();
    renderCursor();
  };

  /** 右鍵：游標空且格子有貨 → 取一半（ceil(count/2)，1 也整拿）；
   *  游標有貨 → 放 1 個（目標必須空或同物品未滿）；0 變 null。
   *  事件必須 preventDefault（擋瀏覽器右鍵選單）。 */
  const rightClickSlot = (index: number): void => {
    const target = slotStack(index);
    if (!cursor) {
      if (!target) return;
      const half = Math.ceil(target.count / 2);
      const rest = target.count - half;
      cursor = { item: target.item, count: half };
      emitChange(index, rest >= 1 ? { item: target.item, count: rest } : null);
    } else if (!target) {
      emitChange(index, { item: cursor.item, count: 1 });
      cursor = cursor.count > 1 ? { item: cursor.item, count: cursor.count - 1 } : null;
    } else if (target.item === cursor.item && target.count < maxStack(target.item)) {
      emitChange(index, { item: target.item, count: target.count + 1 });
      cursor = cursor.count > 1 ? { item: cursor.item, count: cursor.count - 1 } : null;
    } // 目標是別物品或已滿 → 不動（游標保留）
    render();
    renderCursor();
  };

  const wireSlot = (node: HTMLElement, index: number): void => {
    node.className = 'ui-slot';
    node.addEventListener('click', () => leftClickSlot(index));
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      rightClickSlot(index);
    });
  };

  // 游標視覺跟隨（綁在面板上）＋懸停格高亮
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

  return {
    open(pSlots, pSelected, pPick, onClose, crafting, mode = 'creative', options) {
      this.close(); // 上一次的游標用上一次的 opts 交還（close→open 的交接）
      opts = options; // close 之後才換新 opts（見上）
      slotsView = pSlots;
      selected = pSelected;
      onPick = pPick;
      survival = mode === 'survival';
      // Full-screen transparent backdrop captures outside clicks so they never
      // reach the canvas (prevents requestPointerLock while inventory is open).
      // Phase 1 close path: E only fires while pointer-locked and opening the
      // inventory unlocks, so a backdrop ("screen") click closes instead.
      el = document.createElement('div');
      el.className = 'ui-overlay ui-inv-backdrop interactive';
      el.addEventListener('click', (e) => {
        if (e.target !== el) return; // clicks on the panel pick/place, never close
        this.close();
        onClose?.();
      });
      // Esc also closes (does not conflict: input E-gating skips keys while unlocked);
      // removed again in close()
      escHandler = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        this.close();
        onClose?.();
      };
      document.addEventListener('keydown', escHandler);

      const panel = document.createElement('div');
      panel.className = 'ui-inventory interactive';
      const h = document.createElement('h3');
      h.textContent = survival ? '背包' : `方塊（點選放入欄位 ${selected + 1}）`;
      panel.appendChild(h);
      // 2×2 crafting section sits above the grids（ survival；creative 無）。
      if (crafting) unmountCrafting = mountCrafting(panel, crafting);

      // 27 格主背包對應 slots[9..35]、9 格熱鍵列對應 slots[0..8]。
      // 持久節點＋就地重繪：游標模型點擊後只換內容，不重建節點。
      const mainBox = document.createElement('div');
      mainBox.className = 'ui-inv-main';
      mainEls = [];
      for (let i = 0; i < MAIN_SLOTS; i++) {
        const s = document.createElement('div');
        wireSlot(s, HOTBAR_SLOTS + i);
        mainBox.appendChild(s);
        mainEls.push(s);
      }
      const barBox = document.createElement('div');
      barBox.className = 'ui-inv-bar';
      barEls = [];
      for (let i = 0; i < HOTBAR_SLOTS; i++) {
        const s = document.createElement('div');
        wireSlot(s, i);
        barBox.appendChild(s);
        barEls.push(s);
      }
      panel.append(mainBox, barBox);

      if (!survival) {
        // 創造的可捲動全物品清單（生存不渲染 → 免費清單不存在）。
        // 靜態清單：item 種類不會在面板開著時變動，初繪之後不再重畫。
        const listBox = document.createElement('div');
        listBox.className = 'ui-inv-list';
        for (const id of ALL_ITEM_IDS) {
          const s = document.createElement('div');
          s.className = 'ui-slot';
          s.title = stackName(id);
          fillSlot(s, { item: id, count: maxStack(id) }); // 滿堆疊圖示 + 計數
          s.addEventListener('click', () => onPick(selected, { item: id, count: maxStack(id) }));
          listBox.appendChild(s);
        }
        panel.appendChild(listBox);
      }

      panel.addEventListener('mousemove', onPanelMove);
      panel.addEventListener('mouseleave', onPanelLeave);

      render(); // 36 格初繪（掛上 panel 前算好）
      el.appendChild(panel);
      uiRoot.appendChild(el);
      renderCursor(); // 跨 open 保留了沒放回的游標 → 面板開好後補掛
    },
    close() {
      // 關閉面板 → 游標堆疊交還擁有者。**不可用 `??`**：`??` 只在 null/undefined
      // 時取右側，會把「回傳 null ＝ 已全數放回」誤判成「沒有回傳」→ 同一疊
      // 同時在游標與背包 → 複製物品（brief 明文的陷阱；Review Focus #2）。
      if (cursor) {
        let remainder: ItemStack | null = cursor; // 沒有 callback → 留在游標上
        if (opts?.onReturnCursor) remainder = opts.onReturnCursor(cursor);
        cursor = remainder; // 回傳 null → 清空；回傳堆疊 → 下次 open 顯示
      }
      opts = undefined;
      hoverEl = null;
      if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
      }
      unmountCrafting?.();
      unmountCrafting = null;
      if (cursorEl) {
        cursorEl.remove();
        cursorEl = null;
      }
      slotsView = [];
      barEls = [];
      mainEls = [];
      el?.remove();
      el = null;
    },
    isOpen: () => el !== null,
  };
}
