import {
  composeSiteAddress,
  resolveDogsCompatible,
} from "@/src/contexts/reservations/utils/traveler-detail.util";

describe("composeSiteAddress (§5.1)", () => {
  it("town + province", () => {
    expect(composeSiteAddress({ town: "Espirdo", province: "Segovia" })).toBe(
      "Espirdo (Segovia)",
    );
  });

  it("drops a province equal to the town and trims whitespace", () => {
    expect(
      composeSiteAddress({ town: "  Segovia ", province: "segovia" }),
    ).toBe("Segovia");
  });

  it("street and postcode slots when present", () => {
    expect(
      composeSiteAddress({
        street: "Calle Mayor 1",
        postcode: "40191",
        town: "Espirdo",
        province: "Segovia",
      }),
    ).toBe("Calle Mayor 1, 40191 Espirdo (Segovia)");
  });

  it("province only, empty parts and null", () => {
    expect(composeSiteAddress({ town: "", province: "Segovia" })).toBe(
      "Segovia",
    );
    expect(composeSiteAddress({ town: "", province: null })).toBeNull();
    expect(composeSiteAddress(null)).toBeNull();
  });
});

describe("resolveDogsCompatible (§5.2)", () => {
  it("frozen verdict when dogs were declared", () => {
    expect(
      resolveDogsCompatible(
        { mode: "strict", compatible: true, dogs_declared: true },
        1,
      ),
    ).toBe(true);
    expect(
      resolveDogsCompatible(
        { mode: "strict", compatible: false, dogs_declared: true },
        2,
      ),
    ).toBe(false);
  });

  it("null for old snapshots without compatibility", () => {
    expect(resolveDogsCompatible(null, 1)).toBeNull();
    expect(resolveDogsCompatible(undefined, 1)).toBeNull();
  });

  it("null when no dogs were declared", () => {
    expect(
      resolveDogsCompatible(
        { mode: "strict", compatible: true, dogs_declared: false },
        0,
      ),
    ).toBeNull();
    expect(
      resolveDogsCompatible(
        { mode: "strict", compatible: true, dogs_declared: true },
        0,
      ),
    ).toBeNull();
  });
});
