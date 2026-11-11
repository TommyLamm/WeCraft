import './ui.css';
import { experienceProgress, type Experience } from '../core/experience';

/** 經驗 HUD（B17）：畫面下緣的等級數字與經驗進度條。
 *
 *  形狀沿用其他 ui 模組的慣例（eat-progress／toast）：`main` 持有實例、
 *  本模組只管 DOM——
 *  - `set(exp)`：顯示並寫入等級文字與填充條寬度（`experienceProgress` 的
 *    整數百分比）。**同值不重寫**：每幀都會被呼叫 → 快取等級字串與百分比
 *    字串，兩者都沒變就完全不碰 DOM（單一變更路徑，不逐幀寫樣式）。
 *  - `set(null)`：創造模式（或還沒有資料）→ 兩個節點 `display:none`；
 *    已經是隱藏狀態時是 no-op。
 *
 *  幾何規則（`ui.css`）把 `.xp-bar` 塞進熱鍵欄頂緣（66）與血條底（72）之間
 *  的縫，`.xp-level` 疊在血條列中央的空隙——本模組不重複那些數字。 */
export interface XpHud {
  /** 更新顯示；`null` 隱藏兩個節點（創造模式）。同值不重寫 DOM。 */
  set(exp: Experience | null): void;
  /** 移除兩個節點。 */
  dispose(): void;
}

export function createXpHud(uiRoot: HTMLElement): XpHud {
  const bar = document.createElement('div');
  bar.className = 'xp-bar';
  const fill = document.createElement('div');
  fill.className = 'xp-bar-fill';
  bar.appendChild(fill);

  const level = document.createElement('div');
  level.className = 'xp-level';

  // 初始隱藏：第一次 set() 之前不閃出「等級 0」的空條（main 在 startGame
  // 就會 set 一次；沒接線的流程則維持隱藏——安全的預設）。
  bar.style.display = 'none';
  level.style.display = 'none';
  uiRoot.append(bar, level);

  let shown = false; // 目前是否顯示（false ＝ 兩個節點都在 display:none）
  let lastLevel = ''; // 已寫入 .xp-level 的文字（空字串 ＝ 還沒寫過）
  let lastPct = ''; // 已寫入 .xp-bar-fill 的寬度

  return {
    set(exp) {
      if (exp === null) {
        if (!shown) return; // 已隱藏 → 同值不重寫
        shown = false;
        lastLevel = '';
        lastPct = '';
        bar.style.display = 'none';
        level.style.display = 'none';
        return;
      }
      if (!shown) {
        shown = true;
        // 隱藏期間的 DOM 內容不再可信 → 重新顯示時一律重寫一次。
        lastLevel = '';
        lastPct = '';
        bar.style.display = '';
        level.style.display = '';
      }
      const lv = String(exp.level);
      if (lv !== lastLevel) {
        level.textContent = lv;
        lastLevel = lv;
      }
      const pct = `${Math.round(experienceProgress(exp) * 100)}%`;
      if (pct !== lastPct) {
        fill.style.width = pct;
        lastPct = pct;
      }
    },
    dispose() {
      bar.remove();
      level.remove();
    },
  };
}
