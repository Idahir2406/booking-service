import { BadRequestException, NotFoundException } from "@nestjs/common";

import { StripeService } from "@/src/contexts/stripe/services/stripe.service";

const createFixture = (
  profile: { id: number; stripe_account_id: string | null } | null = {
    id: 5,
    stripe_account_id: "acct_host",
  },
  detailsSubmitted = true,
) => {
  const stripe = {
    accounts: {
      retrieve: vi
        .fn()
        .mockResolvedValue({ id: "acct_host", details_submitted: detailsSubmitted }),
      createLoginLink: vi
        .fn()
        .mockResolvedValue({ url: "https://connect.stripe.com/express/abc" }),
    },
  };
  const userProfilesService = {
    findById: vi.fn().mockResolvedValue(profile),
  };
  const service = new StripeService(
    {} as never,
    {} as never,
    userProfilesService as never,
  );
  (service as unknown as { stripe: typeof stripe }).stripe = stripe;
  const assertUserOwnsSite = vi
    .spyOn(service, "assertUserOwnsSite")
    .mockResolvedValue(undefined);
  return { service, stripe, assertUserOwnsSite };
};

describe("StripeService.createDashboardLoginLink", () => {
  it("returns the Express Dashboard login link for the host account", async () => {
    const { service, stripe, assertUserOwnsSite } = createFixture();

    const result = await service.createDashboardLoginLink({
      user_id: 5,
      site_id: 42,
    });

    expect(assertUserOwnsSite).toHaveBeenCalledWith(5, 42);
    expect(stripe.accounts.createLoginLink).toHaveBeenCalledWith("acct_host");
    expect(result).toEqual({
      url: "https://connect.stripe.com/express/abc",
      user_id: 5,
    });
  });

  it("rejects a host without a Stripe account", async () => {
    const { service, stripe } = createFixture({
      id: 5,
      stripe_account_id: null,
    });

    await expect(
      service.createDashboardLoginLink({ user_id: 5 }),
    ).rejects.toThrow(new BadRequestException("stripe_account_missing"));
    expect(stripe.accounts.createLoginLink).not.toHaveBeenCalled();
  });

  it("rejects while onboarding is incomplete", async () => {
    const { service, stripe } = createFixture(undefined, false);

    await expect(
      service.createDashboardLoginLink({ user_id: 5 }),
    ).rejects.toThrow(new BadRequestException("stripe_onboarding_incomplete"));
    expect(stripe.accounts.createLoginLink).not.toHaveBeenCalled();
  });

  it("404s an unknown profile", async () => {
    const { service } = createFixture(null);

    await expect(
      service.createDashboardLoginLink({ user_id: 5 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
