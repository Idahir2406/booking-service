import { describe, expect, it } from "vitest";

import {
  isTravelerCancellationReason,
  isWithinSnapshotRefundWindow,
  reasonRequiresNotes,
  TRAVELER_CANCELLATION_REASONS,
  TRAVELER_CANCELLATION_UI_REASONS,
} from "@/src/contexts/reservations/utils/refund-policy.util";

describe("refund-policy.util", () => {
  it("validates traveler cancellation reasons", () => {
    expect(isTravelerCancellationReason("voluntary")).toBe(true);
    expect(isTravelerCancellationReason("force_majeure")).toBe(true);
    expect(isTravelerCancellationReason("other")).toBe(true);
    expect(isTravelerCancellationReason("transport")).toBe(true);
    expect(isTravelerCancellationReason("refund_me")).toBe(false);
  });

  it("exposes the 13 PDF reasons plus the legacy voluntary alias", () => {
    expect(TRAVELER_CANCELLATION_REASONS).toHaveLength(14);
    expect(new Set(TRAVELER_CANCELLATION_REASONS).size).toBe(14);
    expect(TRAVELER_CANCELLATION_REASONS).toContain("voluntary");
    expect(TRAVELER_CANCELLATION_UI_REASONS).toHaveLength(13);
    expect(TRAVELER_CANCELLATION_UI_REASONS).not.toContain("voluntary");
    expect(TRAVELER_CANCELLATION_UI_REASONS).toEqual([
      "change_of_plans",
      "illness_person",
      "illness_pet",
      "death_person",
      "death_pet",
      "transport",
      "financial",
      "other_accommodation",
      "booking_error",
      "accommodation_conditions",
      "dog_conditions",
      "force_majeure",
      "other",
    ]);
  });

  it("requires notes only for other and force_majeure", () => {
    expect(reasonRequiresNotes("other")).toBe(true);
    expect(reasonRequiresNotes("force_majeure")).toBe(true);
    expect(reasonRequiresNotes("change_of_plans")).toBe(false);
    expect(reasonRequiresNotes("voluntary")).toBe(false);
  });

  it("uses snapshot refund_deadline for the window", () => {
    const snapshot = {
      refund_policy: {
        refund_deadline: "2026-08-09T00:00:00.000Z",
      },
    } as never;
    expect(
      isWithinSnapshotRefundWindow(
        snapshot,
        { checkin: "2026-08-10" },
        new Date("2026-08-08T12:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isWithinSnapshotRefundWindow(
        snapshot,
        { checkin: "2026-08-10" },
        new Date("2026-08-09T12:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
