import { maxStack, type ItemStack } from '../core/items';

// 容器面板與背包面板共用的游標堆疊規則（純函式，不碰 DOM）。
// 左鍵：整疊拿起／放下／交換；右鍵：取一半／放 1 個。
// 所有回傳的堆疊都是新物件，且保留 B7 的 `dur`（受損工具不得被洗成滿耐久）。

export interface CursorClickResult {
  cursor: ItemStack | null;
  target: ItemStack | null;
}

/** 左鍵：游標空 → 拿起整疊（目標格清空）；游標有東西 → 放下整疊
 *  （目標格有東西則兩者交換）。 */
export function cursorLeftClick(
  cursor: ItemStack | null,
  target: ItemStack | null,
): CursorClickResult {
  if (cursor === null) {
    if (target === null) return { cursor: null, target: null };
    return { cursor: { ...target }, target: null };
  }
  if (target === null) return { cursor: null, target: { ...cursor } };
  return { cursor: { ...target }, target: { ...cursor } };
}

/** 右鍵：游標空 → 取一半（`ceil(count/2)`，7 → 拿 4 留 3）；
 *  游標有東西 → 放 1 個（目標格必須空、或同物品且未滿）。 */
export function cursorRightClick(
  cursor: ItemStack | null,
  target: ItemStack | null,
): CursorClickResult {
  if (cursor === null) {
    if (target === null) return { cursor: null, target: null };
    const take = Math.ceil(target.count / 2);
    const rest = target.count - take;
    return {
      cursor: { ...target, count: take },
      target: rest > 0 ? { ...target, count: rest } : null,
    };
  }

  const canPlace =
    target === null ||
    (target.item === cursor.item && target.count < maxStack(target.item));
  if (!canPlace) {
    return {
      cursor: { ...cursor },
      target: target === null ? null : { ...target },
    };
  }

  return {
    cursor: cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null,
    target: { ...cursor, count: (target?.count ?? 0) + 1 },
  };
}
