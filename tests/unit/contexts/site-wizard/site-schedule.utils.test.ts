import { describe, expect, it } from "vitest";

import {
  formatScheduleText,
  isScheduleConfigured,
  parseArrivalTime,
  parseScheduleInput,
  scheduleFromRow,
} from "@/contexts/site-wizard/utils/site-schedule.utils";

describe("parseScheduleInput", () => {
  it("leaves the stored schedule untouched when absent", () => {
    expect(parseScheduleInput({ mode: "all_year" })).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("accepts 30-minute times and empty values", () => {
    expect(
      parseScheduleInput({
        schedule: {
          checkin_from: "15:00",
          checkin_until: "",
          checkout_until: "11:30",
        },
      }),
    ).toEqual({
      ok: true,
      value: {
        checkin_from: "15:00",
        checkin_until: null,
        checkout_until: "11:30",
      },
    });
  });

  it("rejects malformed times and a window that ends before it starts", () => {
    const bad = parseScheduleInput({
      schedule: { checkin_from: "15:15", checkout_until: "25:00" },
    });
    expect(bad.ok).toBe(false);
    const inverted = parseScheduleInput({
      schedule: { checkin_from: "20:00", checkin_until: "15:00" },
    });
    expect(inverted.ok).toBe(false);
  });
});

describe("schedule helpers", () => {
  it("normalizes MySQL TIME rows", () => {
    expect(
      scheduleFromRow({
        checkin_from: "15:00:00",
        checkin_until: null,
        checkout_until: "11:00:00",
      }),
    ).toEqual({
      checkin_from: "15:00",
      checkin_until: null,
      checkout_until: "11:00",
    });
    expect(scheduleFromRow({ checkin_from: null })).toBeNull();
  });

  it("requires check-in start and check-out time", () => {
    expect(
      isScheduleConfigured({
        checkin_from: "15:00",
        checkin_until: null,
        checkout_until: "11:00",
      }),
    ).toBe(true);
    expect(
      isScheduleConfigured({
        checkin_from: "15:00",
        checkin_until: null,
        checkout_until: null,
      }),
    ).toBe(false);
  });

  it("formats the summary line", () => {
    expect(
      formatScheduleText(
        {
          checkin_from: "15:00",
          checkin_until: "21:00",
          checkout_until: "11:00",
        },
        "18:30:00",
      ),
    ).toBe(
      "Entrada de 15:00 a 21:00 · Salida hasta las 11:00 · Llegada estimada: 18:30",
    );
    expect(formatScheduleText(null)).toBe("");
  });
});

describe("parseArrivalTime", () => {
  const schedule = {
    checkin_from: "15:00",
    checkin_until: "21:00",
    checkout_until: "11:00",
  };

  it("is optional", () => {
    expect(parseArrivalTime(undefined, schedule)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("must fall inside the check-in window", () => {
    expect(parseArrivalTime("14:30", schedule).ok).toBe(false);
    expect(parseArrivalTime("21:30", schedule).ok).toBe(false);
    expect(parseArrivalTime("18:00", schedule)).toEqual({
      ok: true,
      value: "18:00",
    });
  });

  it("accepts any 30-minute time without a configured window", () => {
    expect(parseArrivalTime("09:00", null)).toEqual({
      ok: true,
      value: "09:00",
    });
  });
});
