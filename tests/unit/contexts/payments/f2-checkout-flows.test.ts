import type { EntityManager } from "typeorm";
import type { QuotePricingInput } from "@/src/contexts/reservations/utils/reservation-quote.util";

import {
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { createEconomics } from "@/tests/utils/economics";
import { FakeReservationDb } from "@/tests/utils/fake-reservation-db";
import { dogPolicy, pricedQuote } from "@/tests/utils/quote";

import { actors } from "@/src/contexts/payments/domain/audit-actor";
import { PaymentEntity } from "@/src/contexts/payments/entities/payment.entity";
import { PlatformSettingEntity } from "@/src/contexts/payments/entities/platform-setting.entity";
import { ReservationPriceLineEntity } from "@/src/contexts/payments/entities/reservation-price-line.entity";
import { ReservationSnapshotEntity } from "@/src/contexts/payments/entities/reservation-snapshot.entity";
import {
  AUTO_REFUND_REASON,
  PAYMENT_ACTIVATION_OUTCOME,
  ReservationService,
} from "@/src/contexts/reservations/services/reservation.service";
import { signTravelerToken } from "@/src/contexts/reservations/utils/traveler-token.util";
import { envs } from "@/src/contexts/shared/configs/envs";
import { SiteSettingsEntity } from "@/src/contexts/site-wizard/entities/site-settings.entity";
import { StripeService } from "@/src/contexts/stripe/services/stripe.service";

const SITE_ID = 42;
const ROOM_ID = 3;
const CHECKIN = "2027-05-10";
const CHECKOUT = "2027-05-12";
const NIGHTS = ["2027-05-10", "2027-05-11"];

/** Free dogs (supplement none), up to Mediano, no PPP, 150 € deposit. */
const freeDogsPolicy = () =>
  dogPolicy({
    deposit_required: true,
    deposit_amount: "150.00",
    deposit_return: "end_of_stay",
  });

const LUNA = { name: "Luna", weight_kg: 8, is_ppp: false };

const exp = () => Math.floor(Date.now() / 1000) + 3600;

const createFixture = (options: { withSiteSettings?: boolean } = {}) => {
  const db = new FakeReservationDb();
  db.seedNights(SITE_ID, ROOM_ID, NIGHTS, true);
  const { economics } = createEconomics(db.store, options);
  const reservationRepository = {
    manager: {
      transaction: <T>(run: (manager: EntityManager) => Promise<T>) =>
        db.transaction(run),
    },
  };
  const stripeService = {
    createSitePaymentLink: vi.fn(),
    refundPaymentIntent: vi.fn(() => Promise.resolve({ id: "re_1" })),
  };
  const roomsService = {
    findOne: vi.fn().mockResolvedValue({
      id: ROOM_ID,
      name: "Suite Perruna",
      max_guests: 2,
      max_pets: 2,
      price_per_night: "100.00",
      is_active: true,
    }),
  };
  /** Traveler 77 owns active saved dogs 501 and 502 (503 = deleted/foreign). */
  const travelerDogs = {
    findActiveOwnedIds: vi.fn((userId: number, ids: readonly number[]) =>
      Promise.resolve(
        new Set(
          userId === 77 ? ids.filter(id => id === 501 || id === 502) : [],
        ),
      ),
    ),
  };
  const reservationService = new ReservationService(
    reservationRepository as never,
    {
      queryOne: vi.fn().mockResolvedValue({ id: SITE_ID, user_id: 5 }),
    } as never,
    {} as never,
    { find_blocking_overlap: vi.fn().mockResolvedValue(null) } as never,
    roomsService as never,
    {} as never,
    {} as never,
    stripeService as never,
    { logEventInTransaction: vi.fn(() => Promise.resolve()) } as never,
    economics,
    {} as never,
    travelerDogs as never,
  );
  stripeService.createSitePaymentLink.mockImplementation(
    async (body: { reservation_id: number }) => {
      await reservationService.saveStripeCheckoutSessionId(
        body.reservation_id,
        `cs_${body.reservation_id}`,
      );
      return { url: "https://checkout.stripe.test", expires_at: new Date() };
    },
  );
  const quoteWith = (overrides: Partial<QuotePricingInput>) =>
    vi
      .spyOn(reservationService, "quoteReservation")
      .mockResolvedValue(pricedQuote(overrides));
  const checkout = (extra: Record<string, unknown> = {}) =>
    reservationService.checkout({
      site_id: SITE_ID,
      room_id: ROOM_ID,
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guests: 2,
      dogs: [LUNA],
      guest_name: "Ana",
      guest_email: "ana@example.com",
      guest_phone: "600000000",
      ...extra,
    } as never);
  return {
    db,
    reservationService,
    stripeService,
    travelerDogs,
    quoteWith,
    checkout,
  };
};

describe("F2 checkout: complete price, frozen commission and snapshot", () => {
  it("writes every line, commission on the commissionable base and the F2 snapshot", async () => {
    const fixture = createFixture();
    fixture.quoteWith({
      dogs: [LUNA],
      policy: dogPolicy({
        supplement_mode: "per_pet_night",
        supplement_amount: "15.00",
      }),
      dogServices: [
        {
          type: "dog_supply",
          id: 11,
          name: "Kit de bienvenida",
          price_cents: 1200,
          pricing_mode: "per_stay",
        },
      ],
      serviceSelections: [{ type: "dog_supply", id: 11 }],
    });

    const { reservation_id: id } = await fixture.checkout();

    const lines = fixture.db.store.rows(ReservationPriceLineEntity);
    expect(lines.map(line => [line.type, line.amount_cents])).toEqual([
      ["accommodation", 20_000],
      ["board", 3000],
      ["dog_supplement", 3000], // 15 × 1 perro × 2 noches
      ["dog_service", 1200],
    ]);
    // 12 % × 27200 (all commissionable) = 3264
    expect(fixture.db.reservations.get(id)).toMatchObject({
      total_cents: 27_200,
      total: 272,
      subtotal: 272,
      commission: 0,
      commission_cents: 3264,
      pets: 1,
      user_id: 0, // no traveler_token -> guest
    });
    const [snapshot] = fixture.db.store.rows(ReservationSnapshotEntity);
    expect(snapshot.payload).toMatchObject({
      pricing_version: "f2",
      commission: { base: "commissionable", cents: 3264 },
      dogs: [
        {
          name: "Luna",
          weight_kg: 8,
          is_ppp: false,
          size: { slug: "pequeno" },
        },
      ],
      dog_policy: {
        max_size: { slug: "mediano" },
        admitted_sizes: [{ slug: "pequeno" }, { slug: "mediano" }],
        ppp_allowed: false,
        supplement_mode: "per_pet_night",
        supplement_amount_cents: 1500,
        supplement_total_cents: 3000,
        left_alone: "no",
        zones: [{ slug: "terrace", allows_dining: true }],
      },
      services: [
        {
          id: 11,
          pricing_mode: "per_stay",
          price_cents: 1200,
          amount_cents: 1200,
        },
      ],
      refund_policy: { window_hours: 24 },
      timezone: "Europe/Madrid",
    });
    const [payment] = fixture.db.store.rows(PaymentEntity);
    expect(payment.amount_cents).toBe(27_200);
  });

  it("C7: later host policy changes never alter a booked reservation", async () => {
    const fixture = createFixture();
    const policy = freeDogsPolicy();
    fixture.quoteWith({ dogs: [LUNA], policy });
    const { reservation_id: id } = await fixture.checkout();

    // 1 Sept: the host switches to 15 € per dog and night, raises the deposit
    // and forbids medium dogs (mutating the very object used at booking).
    policy.supplement_mode = "per_pet_night";
    policy.supplement_amount = "15.00";
    policy.deposit_amount = "300.00";
    policy.max_size_id = 1;
    policy.zones[0].allows_dining = false;

    // Payment confirmed afterwards: nothing is recomputed.
    await fixture.db.transaction(manager =>
      fixture.reservationService.activateFromPayment(
        {
          reservationId: id,
          checkoutSessionId: `cs_${id}`,
          paymentIntentId: "pi_1",
          amountPaidCents: 23_000,
          actor: actors.stripe("evt_1"),
        },
        manager,
      ),
    );

    const [snapshot] = fixture.db.store.rows(ReservationSnapshotEntity);
    expect(snapshot.payload).toMatchObject({
      dog_policy: {
        supplement_mode: "none",
        supplement_total_cents: 0,
        max_size: { slug: "mediano" },
        deposit: { amount_cents: 15_000 },
        zones: [{ allows_dining: true }],
      },
      total_cents: 23_000,
    });
    expect(
      fixture.db.store
        .rows(ReservationPriceLineEntity)
        .some(line => line.type === "dog_supplement"),
    ).toBe(false);
    expect(fixture.db.reservations.get(id)).toMatchObject({
      status: "confirmed",
      total_cents: 23_000,
    });

    // A NEW quote applies the new conditions.
    const newQuote = pricedQuote({
      dogs: [{ ...LUNA, weight_kg: 4 }],
      policy,
    });
    expect(newQuote.totals?.total_cents).toBe(26_000);
    expect(newQuote.deposit?.amount_cents).toBe(30_000);
  });

  it("incompatible dogs -> 422 with every violation and no reservation", async () => {
    const fixture = createFixture();
    fixture.quoteWith({
      dogs: [{ weight_kg: 30, is_ppp: true }, LUNA, LUNA],
      policy: freeDogsPolicy(),
      siteSettings: { max_pets: 2, max_pets_unlimited: false },
    });

    const error = await fixture.checkout().catch((error_: unknown) => error_);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    const body = (error as UnprocessableEntityException).getResponse() as {
      code: string;
      violations: { code: string }[];
    };
    expect(body.code).toBe("dogs_incompatible");
    expect(body.violations.map(item => item.code).sort()).toEqual(
      ["ppp_not_allowed", "size_not_allowed", "too_many_dogs"].sort(),
    );
    expect(fixture.db.reservations.size).toBe(0);
  });

  it("other invalid quotes keep the legacy 400", async () => {
    const fixture = createFixture();
    fixture.quoteWith({
      serviceSelections: [{ type: "additional_service", id: 5 }],
    });
    await expect(fixture.checkout()).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe("F2 security: traveler id from a PHP-signed token only", () => {
  it("a valid signed token sets user_id; a raw user_id from the browser is ignored", async () => {
    const fixture = createFixture();
    fixture.quoteWith({ dogs: [LUNA] });
    const { reservation_id: id } = await fixture.checkout({
      traveler_token: signTravelerToken(77, exp(), envs.INTERNAL_API_KEY),
      user_id: 1, // tampered field: never read
    });
    expect(fixture.db.reservations.get(id)?.user_id).toBe(77);
  });

  it.each([
    ["forged", () => signTravelerToken(77, exp(), "x".repeat(40))],
    ["expired", () => signTravelerToken(77, 1000, envs.INTERNAL_API_KEY)],
    ["garbage", () => "v1.77.123.abc"],
  ])("%s token -> booked as guest (user_id 0)", async (_label, token) => {
    const fixture = createFixture();
    fixture.quoteWith({ dogs: [LUNA] });
    const { reservation_id: id } = await fixture.checkout({
      traveler_token: token(),
    });
    expect(fixture.db.reservations.get(id)?.user_id).toBe(0);
  });
});

describe("Saved dog links (spec 2.2/2.3): snapshot keeps only own dogs", () => {
  const MAX = { name: "Max", weight_kg: 12, is_ppp: false };
  const snapshotDogs = (fixture: ReturnType<typeof createFixture>) => {
    const [snapshot] = fixture.db.store.rows(ReservationSnapshotEntity);
    return snapshot.payload.dogs as Record<string, unknown>[];
  };

  it("keeps an owned active saved_dog_id and drops a foreign/deleted one", async () => {
    const fixture = createFixture();
    fixture.quoteWith({ dogs: [LUNA, MAX] });
    await fixture.checkout({
      traveler_token: signTravelerToken(77, exp(), envs.INTERNAL_API_KEY),
      dogs: [
        { ...LUNA, saved_dog_id: 501 },
        { ...MAX, saved_dog_id: 503 },
      ],
    });

    expect(fixture.travelerDogs.findActiveOwnedIds).toHaveBeenCalledWith(
      77,
      [501, 503],
    );
    const dogs = snapshotDogs(fixture);
    expect(dogs[0]).toMatchObject({ name: "Luna", saved_dog_id: 501 });
    expect(dogs[1]).toMatchObject({ name: "Max" });
    expect(dogs[1]).not.toHaveProperty("saved_dog_id");
  });

  it("a guest never links saved dogs (no lookup)", async () => {
    const fixture = createFixture();
    fixture.quoteWith({ dogs: [LUNA] });
    await fixture.checkout({ dogs: [{ ...LUNA, saved_dog_id: 501 }] });

    expect(fixture.travelerDogs.findActiveOwnedIds).not.toHaveBeenCalled();
    expect(snapshotDogs(fixture)[0]).not.toHaveProperty("saved_dog_id");
  });

  it("the same saved dog is linked to one row only", async () => {
    const fixture = createFixture();
    fixture.quoteWith({ dogs: [LUNA, LUNA] });
    await fixture.checkout({
      traveler_token: signTravelerToken(77, exp(), envs.INTERNAL_API_KEY),
      dogs: [
        { ...LUNA, saved_dog_id: 502 },
        { ...LUNA, saved_dog_id: 502 },
      ],
    });
    const dogs = snapshotDogs(fixture);
    expect(dogs[0].saved_dog_id).toBe(502);
    expect(dogs[1]).not.toHaveProperty("saved_dog_id");
  });

  it("a failed lookup never blocks the booking and does not touch the price", async () => {
    const fixture = createFixture();
    fixture.quoteWith({ dogs: [LUNA] });
    fixture.travelerDogs.findActiveOwnedIds.mockRejectedValueOnce(
      new Error("db down"),
    );
    const { reservation_id: id } = await fixture.checkout({
      traveler_token: signTravelerToken(77, exp(), envs.INTERNAL_API_KEY),
      dogs: [{ ...LUNA, saved_dog_id: 501 }],
    });

    expect(fixture.db.reservations.get(id)).toMatchObject({
      user_id: 77,
      total_cents: 23_000,
    });
    expect(snapshotDogs(fixture)[0]).not.toHaveProperty("saved_dog_id");
  });
});

describe("F2 webhook amount check uses total_cents", () => {
  it("accepts exactly total_cents and refunds any other amount", async () => {
    const fixture = createFixture();
    fixture.quoteWith({
      dogs: [LUNA],
      policy: dogPolicy({
        supplement_mode: "fixed_stay",
        supplement_amount: 25,
      }),
    });
    const first = await fixture.checkout();

    // total = 200 + 30 + 25 = 255 €; paying the F1 amount (230 €) is a mismatch
    const mismatch = await fixture.db.transaction(manager =>
      fixture.reservationService.activateFromPayment(
        {
          reservationId: first.reservation_id,
          checkoutSessionId: `cs_${first.reservation_id}`,
          paymentIntentId: "pi_low",
          amountPaidCents: 23_000,
        },
        manager,
      ),
    );
    expect(mismatch).toMatchObject({
      outcome: PAYMENT_ACTIVATION_OUTCOME.REFUNDED,
      refundReason: AUTO_REFUND_REASON.AMOUNT_MISMATCH,
    });
  });

  it("activates when the paid amount equals total_cents", async () => {
    const fixture = createFixture();
    fixture.quoteWith({
      dogs: [LUNA],
      policy: dogPolicy({
        supplement_mode: "fixed_stay",
        supplement_amount: 25,
      }),
    });
    const { reservation_id: id } = await fixture.checkout();
    const result = await fixture.db.transaction(manager =>
      fixture.reservationService.activateFromPayment(
        {
          reservationId: id,
          checkoutSessionId: `cs_${id}`,
          paymentIntentId: "pi_ok",
          amountPaidCents: 25_500,
        },
        manager,
      ),
    );
    expect(result.outcome).toBe(PAYMENT_ACTIVATION_OUTCOME.ACTIVATED);
    expect(fixture.db.availability.every(row => !row.is_available)).toBe(true);
  });
});

describe("Stripe Checkout Session built from the price lines", () => {
  it("sends one line_item per non-zero line, summing exactly total_cents", async () => {
    const quote = pricedQuote({
      dogs: [LUNA],
      policy: dogPolicy({
        supplement_mode: "per_pet_stay",
        supplement_amount: "12.50",
      }),
    });
    const lines = quote.internal?.lines ?? [];
    const totalCents = quote.totals?.total_cents ?? 0;
    const reservation = {
      id: 7,
      site_id: SITE_ID,
      status: "pending",
      payment_status: "pending",
      subtotal: 0,
      commission: 0,
      total_cents: totalCents,
      expiration_date: new Date(Date.now() + 40 * 60 * 1000),
    };
    const reservationService = {
      findById: vi.fn().mockResolvedValue(reservation),
      getPriceLines: vi.fn().mockResolvedValue(lines),
      updateExpirationDate: vi.fn(),
      saveStripeCheckoutSessionId: vi.fn(),
    };
    const service = new StripeService(
      {
        queryOne: vi.fn().mockResolvedValue({ id: SITE_ID, name: "Casa" }),
      } as never,
      reservationService as never,
      {} as never,
    );
    const create = vi.fn().mockResolvedValue({ id: "cs_7", url: "https://x" });
    Object.assign(service, {
      stripe: {
        checkout: { sessions: { create } },
        customers: {
          list: vi.fn().mockResolvedValue({ data: [{ id: "cus_1" }] }),
        },
      },
    });

    await service.createSitePaymentLink({
      reservation_id: 7,
      email: "ana@example.com",
    });

    const [params, options] = create.mock.calls[0] as [
      {
        line_items: { quantity: number; price_data: { unit_amount: number } }[];
        payment_intent_data: {
          metadata: Record<string, string>;
          transfer_group: string;
        };
      },
      { idempotencyKey: string },
    ];
    expect(params.line_items).toHaveLength(3); // alojamiento, pensión, suplemento
    const sum = params.line_items.reduce(
      (acc, item) => acc + item.price_data.unit_amount * item.quantity,
      0,
    );
    expect(sum).toBe(totalCents);
    expect(totalCents).toBe(24_250);
    expect(params.payment_intent_data).toMatchObject({
      metadata: { reservation_id: "7", total_cents: "24250" },
      transfer_group: "reservation_7",
    });
    expect(options.idempotencyKey).toBe("checkout:7");
  });
});

const seedPolicy = (
  fixture: ReturnType<typeof createFixture>,
  deferred: boolean,
) => {
  void fixture.db.store.repository(SiteSettingsEntity).insert({
    site_id: SITE_ID,
    cancellation_policy_type: "free_cancellation",
    cancellation_deadline_days: 7,
    cancellation_penalty_type: "percent_50",
    no_show_policy: "same_as_cancellation",
    grace_after_booking_hours: null,
    early_cancellation_weeks: null,
    timezone: "Atlantic/Canary",
  });
  void fixture.db.store.repository(PlatformSettingEntity).insert({
    key: "deferred_charge_enabled",
    value: deferred ? "true" : "false",
  });
};

describe("Fase 3 checkout: structured cancellation policy of the site", () => {
  it("deferred charge off: immediate charge, structured snapshot in the site timezone", async () => {
    const fixture = createFixture({ withSiteSettings: true });
    seedPolicy(fixture, false);
    fixture.quoteWith({ dogs: [LUNA], policy: freeDogsPolicy() });
    const result = await fixture.checkout();
    const reservation = fixture.db.reservations.get(result.reservation_id);
    expect(reservation).toMatchObject({
      charge_mode: "immediate",
      timezone: "Atlantic/Canary",
    });
    const [snapshot] = fixture.db.store.rows(ReservationSnapshotEntity);
    expect(snapshot.payload).toMatchObject({
      timezone: "Atlantic/Canary",
      refund_policy: {
        rule: "structured_cancellation_policy",
        // 03/05/2027 18:00 Canarias (WEST) = 17:00Z
        refund_deadline: "2027-05-03T17:00:00.000Z",
        deadline_local_date: "2027-05-03",
        deadline_local_time: "18:00",
        timezone: "Atlantic/Canary",
        cancellation: { policy_type: "free_cancellation", deadline_days: 7 },
        charge_mode: "immediate",
        charge_at: null,
      },
    });
  });

  it("deferred charge on: the reservation is frozen as flexible", async () => {
    const fixture = createFixture({ withSiteSettings: true });
    seedPolicy(fixture, true);
    fixture.quoteWith({ dogs: [LUNA], policy: freeDogsPolicy() });
    const result = await fixture.checkout();
    expect(
      fixture.db.reservations.get(result.reservation_id)?.charge_mode,
    ).toBe("flexible");
    const [snapshot] = fixture.db.store.rows(ReservationSnapshotEntity);
    expect(snapshot.payload).toMatchObject({
      refund_policy: {
        charge_mode: "flexible",
        charge_at: "2027-05-03T17:00:00.000Z",
      },
    });
  });

  it("site without policy: legacy rule and immediate charge (unchanged)", async () => {
    const fixture = createFixture({ withSiteSettings: true });
    fixture.quoteWith({ dogs: [LUNA], policy: freeDogsPolicy() });
    const result = await fixture.checkout();
    expect(fixture.db.reservations.get(result.reservation_id)).toMatchObject({
      charge_mode: "immediate",
      timezone: "Europe/Madrid",
    });
    const [snapshot] = fixture.db.store.rows(ReservationSnapshotEntity);
    expect(snapshot.payload).toMatchObject({
      refund_policy: {
        rule: "legacy_host_full_refund_until_24h_before_checkin",
        window_hours: 24,
      },
    });
    expect(
      (snapshot.payload as { refund_policy: Record<string, unknown> })
        .refund_policy.cancellation,
    ).toBeUndefined();
  });
});
