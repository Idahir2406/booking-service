import type { EntityManager } from "typeorm";

import { createEconomicsStub } from "@/tests/utils/economics";

import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { ReservationDisputeEntity } from "@/src/contexts/reservations/entities/reservation-dispute.entity";
import { ReservationWebhookService } from "@/src/contexts/webhook/services/reservation-webhook.service";
import { AfterCommitTask } from "@/src/contexts/webhook/types/stripe-webhook-event.type";

const PI = "pi_disputed";

const createFixture = (overrides: Partial<ReservationEntity> = {}) => {
  const reservation = Object.assign(new ReservationEntity(), {
    id: 7,
    site_id: 42,
    room_id: 3,
    status: "finalized",
    payment_status: "paid",
    payout_status: "held",
    stripe_payment_intent_id: PI,
    subtotal: 200,
    commission: 0,
    total: 200,
    refund_seq: 0,
    ...overrides,
  });
  const disputes: ReservationDisputeEntity[] = [];
  let nextDisputeId = 1;

  const reservationRepository = {
    findOne: vi.fn(() => Promise.resolve(reservation)),
    save: vi.fn((value: ReservationEntity) => Promise.resolve(value)),
  };
  const disputeRepository = {
    create: (value: Partial<ReservationDisputeEntity>) =>
      Object.assign(new ReservationDisputeEntity(), { status: "open" }, value),
    save: (value: ReservationDisputeEntity) => {
      if (!value.id) {
        value.id = nextDisputeId;
        nextDisputeId += 1;
        disputes.push(value);
      }
      return Promise.resolve(value);
    },
    findOne: (options: { where: { stripe_dispute_id: string } }) =>
      Promise.resolve(
        disputes.find(
          row => row.stripe_dispute_id === options.where.stripe_dispute_id,
        ) ?? null,
      ),
    count: (options: {
      where: { reservation_id: number; status: string; id: { value: number } };
    }) =>
      Promise.resolve(
        disputes.filter(
          row =>
            row.reservation_id === options.where.reservation_id &&
            row.status === options.where.status &&
            row.id !== options.where.id.value,
        ).length,
      ),
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === ReservationDisputeEntity
        ? disputeRepository
        : reservationRepository,
  } as unknown as EntityManager;

  const reservationService = {
    getSiteById: vi.fn().mockResolvedValue({ id: 42 }),
  };
  const reservationEmailService = {
    sendStripeDisputeEmails: vi.fn(() => Promise.resolve()),
    sendRefundProcessedEmails: vi.fn(() => Promise.resolve()),
    sendRefundFailedEmails: vi.fn(() => Promise.resolve()),
  };
  const reservationEventService = {
    logEventInTransaction: vi.fn(() => Promise.resolve()),
  };
  const service = new ReservationWebhookService(
    reservationService as never,
    reservationEmailService as never,
    reservationEventService as never,
    createEconomicsStub() as never,
  );
  return {
    service,
    manager,
    reservation,
    disputes,
    reservationEmailService,
    reservationEventService,
  };
};

const disputeEvent = (type: string, id: string, status: string) => ({
  id: `evt_${id}_${status}`,
  type,
  data: {
    object: {
      id,
      payment_intent: PI,
      reason: "fraudulent",
      status,
      amount: 20_000,
    },
  },
});

describe("Stripe disputes block and unblock the host payout", () => {
  it("charge.dispute.created blocks the payout, records the dispute and emails after commit", async () => {
    const fixture = createFixture();
    const afterCommit: AfterCommitTask[] = [];

    await fixture.service.handleChargeDisputeCreated(
      disputeEvent("charge.dispute.created", "dp_1", "needs_response"),
      fixture.manager,
      afterCommit,
    );

    expect(fixture.reservation.payout_status).toBe("blocked");
    expect(fixture.disputes).toHaveLength(1);
    expect(fixture.disputes[0]).toMatchObject({
      source: "stripe",
      stripe_dispute_id: "dp_1",
      status: "open",
    });
    expect(
      fixture.reservationEmailService.sendStripeDisputeEmails,
    ).not.toHaveBeenCalled();
    await Promise.all(afterCommit.map(task => task()));
    expect(
      fixture.reservationEmailService.sendStripeDisputeEmails,
    ).toHaveBeenCalledOnce();
  });

  it("a replayed dispute.created does not create a second dispute", async () => {
    const fixture = createFixture();
    const event = disputeEvent(
      "charge.dispute.created",
      "dp_1",
      "needs_response",
    );

    await fixture.service.handleChargeDisputeCreated(
      event,
      fixture.manager,
      [],
    );
    await fixture.service.handleChargeDisputeCreated(
      event,
      fixture.manager,
      [],
    );

    expect(fixture.disputes).toHaveLength(1);
  });

  it("won -> unblocks when nothing else blocks", async () => {
    const fixture = createFixture();
    await fixture.service.handleChargeDisputeCreated(
      disputeEvent("charge.dispute.created", "dp_1", "needs_response"),
      fixture.manager,
      [],
    );

    await fixture.service.handleChargeDisputeClosed(
      disputeEvent("charge.dispute.closed", "dp_1", "won"),
      fixture.manager,
    );

    expect(fixture.reservation.payout_status).toBe("held");
    expect(fixture.disputes[0]).toMatchObject({
      status: "resolved_release",
      stripe_status: "won",
    });
  });

  it("won -> stays blocked while another dispute/report is open", async () => {
    const fixture = createFixture();
    await fixture.service.handleChargeDisputeCreated(
      disputeEvent("charge.dispute.created", "dp_1", "needs_response"),
      fixture.manager,
      [],
    );
    fixture.disputes.push(
      Object.assign(new ReservationDisputeEntity(), {
        id: 99,
        reservation_id: 7,
        status: "open",
        source: "guest_report",
      }),
    );

    await fixture.service.handleChargeDisputeClosed(
      disputeEvent("charge.dispute.closed", "dp_1", "won"),
      fixture.manager,
    );

    expect(fixture.reservation.payout_status).toBe("blocked");
  });

  it("lost -> keeps the payout blocked and records it", async () => {
    const fixture = createFixture();
    await fixture.service.handleChargeDisputeCreated(
      disputeEvent("charge.dispute.created", "dp_1", "needs_response"),
      fixture.manager,
      [],
    );

    await fixture.service.handleChargeDisputeClosed(
      disputeEvent("charge.dispute.closed", "dp_1", "lost"),
      fixture.manager,
    );

    expect(fixture.reservation.payout_status).toBe("blocked");
    expect(fixture.disputes[0]?.status).toBe("resolved_refund");
    expect(
      fixture.reservationEventService.logEventInTransaction,
    ).toHaveBeenCalledWith(
      fixture.manager,
      7,
      "stripe_dispute_lost",
      expect.objectContaining({ dispute_id: "dp_1" }),
    );
  });
});

const refundedEvent = (amountRefunded: number) => ({
  id: `evt_refund_${amountRefunded}`,
  type: "charge.refunded",
  data: {
    object: {
      id: "ch_1",
      payment_intent: PI,
      amount: 20_000,
      amount_refunded: amountRefunded,
      refunded: amountRefunded >= 20_000,
    },
  },
});

describe("charge.refunded", () => {
  it("distinguishes partial from full refunds", async () => {
    const fixture = createFixture();

    await fixture.service.handleChargeRefunded(
      refundedEvent(5000),
      fixture.manager,
      [],
    );
    expect(fixture.reservation.payment_status).toBe("partially_refunded");
    expect(fixture.reservation.amount_refunded).toBe(50);

    await fixture.service.handleChargeRefunded(
      refundedEvent(20_000),
      fixture.manager,
      [],
    );
    expect(fixture.reservation.payment_status).toBe("refunded");
  });

  it("does not send a second refund email for a refund our own flow already recorded", async () => {
    const fixture = createFixture({
      payment_status: "refunded",
      amount_refunded: 200,
      status: "cancelled",
    });
    const afterCommit: AfterCommitTask[] = [];

    await fixture.service.handleChargeRefunded(
      refundedEvent(20_000),
      fixture.manager,
      afterCommit,
    );

    expect(afterCommit).toHaveLength(0);
  });

  it("emails when the refund was made outside our flows (Dashboard)", async () => {
    const fixture = createFixture();
    const afterCommit: AfterCommitTask[] = [];

    await fixture.service.handleChargeRefunded(
      refundedEvent(20_000),
      fixture.manager,
      afterCommit,
    );
    await Promise.all(afterCommit.map(task => task()));

    expect(
      fixture.reservationEmailService.sendRefundProcessedEmails,
    ).toHaveBeenCalledOnce();
  });
});
