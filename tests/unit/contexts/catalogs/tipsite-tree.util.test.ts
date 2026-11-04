import { describe, expect, it } from "vitest";

import { buildTipsiteTree } from "@/contexts/catalogs/utils/tipsite-tree.util";

describe("buildTipsiteTree", () => {
  it("places children right after their parent with depth 1", () => {
    const tree = buildTipsiteTree([
      { id: 1, id_parent: 0, name: "Hoteles" },
      { id: 11, id_parent: 1, name: "Hotel boutique" },
      { id: 2, id_parent: 0, name: "Casas Rurales" },
      { id: 12, id_parent: 1, name: "Hostal" },
    ]);

    expect(tree.map(node => [node.id, node.depth])).toEqual([
      [1, 0],
      [11, 1],
      [12, 1],
      [2, 0],
    ]);
  });

  it("drops children whose parent is not listed", () => {
    const tree = buildTipsiteTree([
      { id: 1, id_parent: 0, name: "Hoteles" },
      { id: 20, id_parent: 99, name: "Orphan" },
    ]);
    expect(tree.map(node => node.id)).toEqual([1]);
  });
});
