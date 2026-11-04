import { ForbiddenException } from "@nestjs/common";

import { StripeService } from "@/src/contexts/stripe/services/stripe.service";
import {
  reservationTransferGroup,
  stripeIdempotencyKeys,
} from "@/src/contexts/stripe/utils/stripe-idempotency.util";

const createFixture = () => {
  const stripe = {
    refunds: { create: vi.fn().mockResolvedValue({ id: "re_1" }) },
    transfers: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({ id: "tr_1" }),
    },
    paymentIntents: {
      retrieve: vi.fn().mockResolvedValue({ latest_charge: "ch_1" }),
    },
    accounts: { create: vi.fn().mockResolvedValue({ id: "acct_1" }) },
  };
  const userProfilesService = {
    findById: vi.fn().mockResolvedValue({
      id: 5,
      email: "host@example.com",
      stripe_account_id: "acct_host",
    }),
    saveStripeAccountId: vi.fn(),
  };
  const mysqlService = {
    queryOne: vi.fn().mockResolvedValue({
      id: 42,
      user_id: 0,
      email: "Host@Example.com",
      email2: null,
    }),
  };
  const service = new StripeService(
    mysqlService as never,
    {} as never,
    userProfilesService as never,
  );
  (service as unknown as { stripe: typeof stripe }).stripe = stripe;
  return { service, stripe, mysqlService, userProfilesService };
};

describe("Stripe idempotency keys", () => {
  it("uses the documented key formats", () => {
    expect(stripeIdempotencyKeys.refund(7, 2)).toBe("refund:7:2");
    expect(stripeIdempotencyKeys.transfer(7)).toBe("transfer:7");
    expect(stripeIdempotencyKeys.checkoutSession(7)).toBe("checkout:7");
    expect(reservationTransferGroup(7)).toBe("reservation_7");
  });

  it("refunds.create carries refund:{reservationId}:{n}", async () => {
    const { service, stripe } = createFixture();

    await service.refundPaymentIntent({
      reservationId: 7,
      sequence: 1,
      paymentIntentId: "pi_1",
    });

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_1" }),
      { idempotencyKey: "refund:7:1" },
    );
  });

  it("transfers.create carries transfer:{reservationId} and the transfer_group", async () => {
    const { service, stripe } = createFixture();

    await service.transferHostPayout({
      reservationId: 7,
      paymentIntentId: "pi_1",
      hostUserId: 5,
      totalPaidCents: 10_000,
    });

    expect(stripe.transfers.list).toHaveBeenCalledWith(
      expect.objectContaining({ transfer_group: "reservation_7" }),
    );
    expect(stripe.transfers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        transfer_group: "reservation_7",
        source_transaction: "ch_1",
        destination: "acct_host",
      }),
      { idempotencyKey: "transfer:7" },
    );
  });

  it("never re-sends a transfer that already exists for the reservation", async () => {
    const { service, stripe } = createFixture();
    stripe.transfers.list.mockResolvedValueOnce({
      data: [{ id: "tr_existing", reversed: false }],
    });

    const transfer = await service.transferHostPayout({
      reservationId: 7,
      paymentIntentId: "pi_1",
      hostUserId: 5,
      totalPaidCents: 10_000,
    });

    expect(transfer?.id).toBe("tr_existing");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });
});

describe("host ownership checks", () => {
  it("accepts a legacy site (user_id = 0) linked by email", async () => {
    const { service } = createFixture();
    await expect(service.assertUserOwnsSite(5, 42)).resolves.toBeUndefined();
  });

  it("rejects a site owned by another user", async () => {
    const { service, mysqlService } = createFixture();
    mysqlService.queryOne.mockResolvedValueOnce({
      id: 42,
      user_id: 99,
      email: "host@example.com",
    });
    await expect(service.assertUserOwnsSite(5, 42)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("rejects a legacy site whose email does not match", async () => {
    const { service, mysqlService } = createFixture();
    mysqlService.queryOne.mockResolvedValueOnce({
      id: 42,
      user_id: 0,
      email: "other@example.com",
      email2: "",
    });
    await expect(service.assertUserOwnsSite(5, 42)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
