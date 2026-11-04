import type { TipsiteOption } from "../types/site-form-catalog.types";

export interface TipsiteRow {
  id: number;
  id_parent: number;
  name: string;
}

/**
 * Flattens jtipsite into display order: each root (id_parent = 0) followed by
 * its direct children (depth 1). Input must already be sorted by sequence, id.
 * Children whose parent is not in the list (inactive/missing) are dropped, the
 * same way the legacy PHP tree hides them.
 */
export function buildTipsiteTree(rows: readonly TipsiteRow[]): TipsiteOption[] {
  const childrenByParent = new Map<number, TipsiteRow[]>();
  for (const row of rows) {
    if (row.id_parent !== 0) {
      const siblings = childrenByParent.get(row.id_parent) ?? [];
      siblings.push(row);
      childrenByParent.set(row.id_parent, siblings);
    }
  }

  const result: TipsiteOption[] = [];
  for (const root of rows.filter(row => row.id_parent === 0)) {
    result.push({ ...root, depth: 0 });
    for (const child of childrenByParent.get(root.id) ?? []) {
      result.push({ ...child, depth: 1 });
    }
  }
  return result;
}
