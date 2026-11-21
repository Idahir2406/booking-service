import type { ProviderPetPolicy } from "@/contexts/providers/domain/provider.types";

import { describe, expect, it } from "vitest";

import {
  canActivate,
  hasReadablePetPolicy,
  IMPORT_ELIGIBILITY,
  importEligibility,
  initialPetsSnapshot,
  readContentExtras,
  readPetsSnapshot,
  slugify,
  toPreviousProfileMode,
  uniqueSlug,
} from "@/contexts/providers/admin/domain/provider-import";

function policy(overrides: Partial<ProviderPetPolicy> = {}): ProviderPetPolicy {
  return {
    allowed: null,
    fee: null,
    feeAmountCents: null,
    feeCurrency: null,
    feeBasis: null,
    weightLimit: null,
    terms: null,
    text: null,
    ...overrides,
  };
}

describe("hasReadablePetPolicy", () => {
  it("accepts a text, terms or a structured rule", () => {
    expect(
      hasReadablePetPolicy(policy({ text: "Pets allowed on request" })),
    ).toBe(true);
    expect(hasReadablePetPolicy(policy({ terms: "Max 1 dog per room" }))).toBe(
      true,
    );
    expect(hasReadablePetPolicy(policy({ fee: true }))).toBe(true);
    expect(hasReadablePetPolicy(policy({ feeAmountCents: 1500 }))).toBe(true);
    expect(hasReadablePetPolicy(policy({ weightLimit: "10 kg" }))).toBe(true);
  });

  it("rejects empty or trivial policies (HTML ignored)", () => {
    expect(hasReadablePetPolicy(policy())).toBe(false);
    expect(hasReadablePetPolicy(policy({ text: "<p>Yes</p>" }))).toBe(false);
    expect(hasReadablePetPolicy(policy({ terms: "  " }))).toBe(false);
  });
});

describe("importEligibility", () => {
  it("is ok with pets allowed and a readable policy", () => {
    expect(
      importEligibility({
        petsAllowed: true,
        petPolicy: policy({
          allowed: true,
          text: "Dogs welcome, 10 EUR/night",
        }),
      }),
    ).toBe(IMPORT_ELIGIBILITY.OK);
  });

  it("never imports an explicit no-pets hotel (structured policy wins)", () => {
    expect(
      importEligibility({
        petsAllowed: false,
        petPolicy: policy({ text: "No pets allowed here" }),
      }),
    ).toBe(IMPORT_ELIGIBILITY.PETS_NOT_ALLOWED);
    expect(
      importEligibility({
        petsAllowed: true,
        petPolicy: policy({ allowed: false }),
      }),
    ).toBe(IMPORT_ELIGIBILITY.PETS_NOT_ALLOWED);
  });

  it("needs a manual review when pets are unknown or the policy is unreadable", () => {
    expect(importEligibility({ petsAllowed: null, petPolicy: policy() })).toBe(
      IMPORT_ELIGIBILITY.NEEDS_PETS_REVIEW,
    );
    expect(
      importEligibility({
        petsAllowed: true,
        petPolicy: policy({ allowed: true }),
      }),
    ).toBe(IMPORT_ELIGIBILITY.NEEDS_PETS_REVIEW);
  });
});

describe("pets snapshot", () => {
  it("starts unreviewed and keeps the provider policy", () => {
    const snapshot = initialPetsSnapshot({
      petsAllowed: null,
      petPolicy: policy({ allowed: true, text: "Dogs allowed" }),
    });
    expect(snapshot.petsAllowed).toBe(true);
    expect(snapshot.reviewed).toBe(false);
    expect(snapshot.provider_pet_policy.text).toBe("Dogs allowed");
    expect(canActivate(snapshot)).toBe(false);
  });

  it("activates only when reviewed and allowed", () => {
    const base = initialPetsSnapshot({
      petsAllowed: true,
      petPolicy: policy({ allowed: true, text: "Dogs allowed" }),
    });
    expect(canActivate({ ...base, reviewed: true })).toBe(true);
    expect(
      canActivate({
        ...base,
        reviewed: true,
        petsAllowed: false,
        petPolicy: policy({ allowed: false }),
      }),
    ).toBe(false);
    expect(canActivate(null)).toBe(false);
  });

  it("reads stored snapshots tolerantly", () => {
    expect(readPetsSnapshot(null)).toBeNull();
    expect(readPetsSnapshot({ petsAllowed: true })).toBeNull();
    const read = readPetsSnapshot({
      petsAllowed: true,
      petPolicy: policy({ allowed: true }),
      reviewed: true,
      reviewed_by: "admin",
    });
    expect(read?.reviewed).toBe(true);
    expect(read?.reviewed_by).toBe("admin");
    expect(read?.provider_pet_policy.allowed).toBe(true);
  });
});

describe("slugs", () => {
  it("slugifies names like alias_l1", () => {
    expect(slugify("Hôtel Ça Va & Spa, Barcelona!")).toBe(
      "hotel-ca-va-spa-barcelona",
    );
    expect(slugify("***")).toBe("alojamiento");
    expect(slugify("a".repeat(120))).toHaveLength(80);
  });

  it("finds the first free alias", () => {
    expect(uniqueSlug("hotel-sol", new Set())).toBe("hotel-sol");
    expect(uniqueSlug("hotel-sol", new Set(["hotel-sol", "hotel-sol-2"]))).toBe(
      "hotel-sol-3",
    );
  });
});

describe("content extras / previous profile mode", () => {
  it("defaults to a link restoring legacy", () => {
    expect(readContentExtras(null)).toMatchObject({
      origin: "link",
      previous_profile_mode: "legacy",
      images_imported_count: 0,
    });
    expect(
      readContentExtras({ origin: "import", previous_profile_mode: "booking" }),
    ).toMatchObject({ origin: "import", previous_profile_mode: "booking" });
  });

  it("never stores 'provider' as the mode to restore", () => {
    expect(toPreviousProfileMode("booking")).toBe("booking");
    expect(toPreviousProfileMode("provider")).toBe("legacy");
    expect(toPreviousProfileMode(null)).toBe("legacy");
  });
});
