import {
  buildTravelerAlerts,
  FREE_CANCEL_ALERT_HOURS,
  TRAVELER_ALERT,
  type TravelerAlertCandidate,
} from "@/src/contexts/reservations/utils/traveler-alerts.util";

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date("2099-07-10T12:00:00.000Z");

const hoursFromNow = (hours: number) =>
  new Date(NOW.getTime() + hours * HOUR_MS).toISOString();

const candidate = (
  overrides: Partial<TravelerAlertCandidate> = {},
): TravelerAlertCandidate => ({
  reservation_id: 1,
  code: "#RES-1",
  site_name: "Casa Rural",
  status: "confirmed",
  has_pending_refund: false,
  free_cancel: {
    can_cancel: true,
    within_free_period: true,
    deadline_iso: hoursFromNow(48),
  },
  has_pending_change_proposal: false,
  has_pending_alternative: false,
  ...overrides,
});

const freeCancelAt = (hours: number) =>
  candidate({
    free_cancel: {
      can_cancel: true,
      within_free_period: true,
      deadline_iso: hoursFromNow(hours),
    },
  });

const types = (list: TravelerAlertCandidate[]) =>
  buildTravelerAlerts({ reservations: list }, NOW).map(alert => alert.type);

describe("buildTravelerAlerts (F-PV6)", () => {
  it("D10 window is 72 hours", () => {
    expect(FREE_CANCEL_ALERT_HOURS).toBe(72);
  });

  it("free-cancel alert at 71 h, not at 73 h, not once the deadline passed", () => {
    expect(types([freeCancelAt(71)])).toEqual([
      TRAVELER_ALERT.FREE_CANCEL_ENDING,
    ]);
    expect(types([freeCancelAt(72)])).toEqual([
      TRAVELER_ALERT.FREE_CANCEL_ENDING,
    ]);
    expect(types([freeCancelAt(73)])).toEqual([]);
    expect(types([freeCancelAt(0)])).toEqual([]);
    expect(types([freeCancelAt(-1)])).toEqual([]);
  });

  it("free-cancel alert carries the frozen deadline and reservation identity", () => {
    const [alert] = buildTravelerAlerts(
      { reservations: [freeCancelAt(10)] },
      NOW,
    );
    expect(alert).toEqual({
      type: TRAVELER_ALERT.FREE_CANCEL_ENDING,
      reservation_id: 1,
      code: "#RES-1",
      site_name: "Casa Rural",
      deadline_iso: hoursFromNow(10),
    });
  });

  it("no free-cancel alert unless confirmed, cancellable and inside the free period", () => {
    expect(types([candidate({ status: "payment_pending" })])).toEqual([]);
    expect(types([candidate({ status: "in_progress" })])).toEqual([]);
    expect(types([candidate({ free_cancel: null })])).toEqual([]);
    expect(
      types([
        candidate({
          free_cancel: {
            can_cancel: false,
            within_free_period: true,
            deadline_iso: hoursFromNow(10),
          },
        }),
      ]),
    ).toEqual([]);
    expect(
      types([
        candidate({
          free_cancel: {
            can_cancel: true,
            within_free_period: false,
            deadline_iso: hoursFromNow(10),
          },
        }),
      ]),
    ).toEqual([]);
    expect(
      types([
        candidate({
          free_cancel: {
            can_cancel: true,
            within_free_period: true,
            deadline_iso: null,
          },
        }),
      ]),
    ).toEqual([]);
    expect(
      types([
        candidate({
          free_cancel: {
            can_cancel: true,
            within_free_period: true,
            deadline_iso: "not-a-date",
          },
        }),
      ]),
    ).toEqual([]);
  });

  it("cancelled reservation without pending review has no alerts", () => {
    expect(
      types([candidate({ status: "cancelled", free_cancel: null })]),
    ).toEqual([]);
    // Even with stale inputs: cancelled never gets free-cancel/proposal alerts.
    expect(
      types([
        candidate({
          status: "cancelled",
          has_pending_change_proposal: true,
          has_pending_alternative: true,
        }),
      ]),
    ).toEqual([]);
  });

  it("incident in review → alert (and no free-cancel alert)", () => {
    const alerts = buildTravelerAlerts(
      {
        reservations: [
          candidate({ status: "incident_review", has_pending_refund: true }),
        ],
      },
      NOW,
    );
    expect(alerts).toEqual([
      {
        type: TRAVELER_ALERT.INCIDENT_REVIEW,
        reservation_id: 1,
        code: "#RES-1",
        site_name: "Casa Rural",
        deadline_iso: null,
      },
    ]);
  });

  it("cancelled with a refund pending V4P review (force_majeure) → incident alert", () => {
    expect(
      types([
        candidate({
          status: "cancelled",
          has_pending_refund: true,
          free_cancel: null,
        }),
      ]),
    ).toEqual([TRAVELER_ALERT.INCIDENT_REVIEW]);
  });

  it("F-PV7a: cancelled with an open incident (refund_issue) → incident alert", () => {
    expect(
      types([
        candidate({
          status: "cancelled",
          has_open_incident: true,
          free_cancel: null,
        }),
      ]),
    ).toEqual([TRAVELER_ALERT.INCIDENT_REVIEW]);
  });

  it("change proposal / alternative alerts only when the extension flags are set (F-PV7b)", () => {
    expect(types([candidate({ free_cancel: null })])).toEqual([]);
    expect(
      types([
        candidate({
          free_cancel: null,
          has_pending_change_proposal: true,
          has_pending_alternative: true,
        }),
      ]),
    ).toEqual([
      TRAVELER_ALERT.CHANGE_PROPOSAL_PENDING,
      TRAVELER_ALERT.ALTERNATIVE_PENDING,
    ]);
  });

  it("orders free-cancel first (earliest deadline), then incidents", () => {
    const alerts = buildTravelerAlerts(
      {
        reservations: [
          candidate({ reservation_id: 3, status: "incident_review" }),
          { ...freeCancelAt(60), reservation_id: 2 },
          { ...freeCancelAt(5), reservation_id: 4 },
        ],
      },
      NOW,
    );
    expect(alerts.map(alert => [alert.type, alert.reservation_id])).toEqual([
      [TRAVELER_ALERT.FREE_CANCEL_ENDING, 4],
      [TRAVELER_ALERT.FREE_CANCEL_ENDING, 2],
      [TRAVELER_ALERT.INCIDENT_REVIEW, 3],
    ]);
  });

  it("never generates debt or payment-method alerts", () => {
    const allowed = new Set<string>(Object.values(TRAVELER_ALERT));
    expect([...allowed].some(type => /debt|deuda|payment/i.test(type))).toBe(
      false,
    );
    const alerts = buildTravelerAlerts(
      {
        reservations: [
          candidate({ status: "payment_pending", free_cancel: null }),
          candidate({ status: "in_progress", free_cancel: null }),
          freeCancelAt(10),
          candidate({ status: "incident_review" }),
        ],
      },
      NOW,
    );
    for (const alert of alerts) {
      expect(allowed.has(alert.type)).toBe(true);
    }
  });

  it("is pure: same input and now → same output, input untouched", () => {
    const input = { reservations: [freeCancelAt(10)] };
    const frozen = JSON.stringify(input);
    expect(buildTravelerAlerts(input, NOW)).toEqual(
      buildTravelerAlerts(input, NOW),
    );
    expect(JSON.stringify(input)).toBe(frozen);
  });
});
