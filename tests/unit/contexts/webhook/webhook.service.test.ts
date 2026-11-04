import type { EntityManager } from "typeorm";

import { ConflictException } from "@nestjs/common";

import {
  StripeWebhookEventEntity,
  WEBHOOK_EVENT_STATUS,
} from "@/src/contexts/webhook/entities/stripe-webhook-event.entity";
import {
  WEBHOOK_PROCESSING_LEASE_MS,
  WebhookService,
} from "@/src/contexts/webhook/services/webhook.service";
import { AfterCommitTask } from "@/src/contexts/webhook/types/stripe-webhook-event.type";

/** A failed transaction must not stall the ones queued after it. */
function keepQueueAlive(): void {
  // intentionally empty: the error is surfaced to the caller of transaction()
}

/** In-memory stripe_webhook_events with serialized transactions + rollback. */
class FakeEventStore {
  rows = new Map<string, StripeWebhookEventEntity>();
  private queue: Promise<unknown> = Promise.resolve();

  transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const snapshot = new Map(
        [...this.rows].map(([id, row]) => [id, { ...row }]),
      );
      try {
        return await run(this.manager());
      } catch (error) {
        this.rows = snapshot as Map<string, StripeWebhookEventEntity>;
        throw error;
      }
    });
    this.queue = next.catch(keepQueueAlive);
    return next;
  }

  repository() {
    return {
      createQueryBuilder: () => {
        let values: Partial<StripeWebhookEventEntity> = {};
        const builder = {
          insert: () => builder,
          into: () => builder,
          values: (value: Partial<StripeWebhookEventEntity>) => {
            values = value;
            return builder;
          },
          orIgnore: () => builder,
          execute: () => {
            const id = String(values.stripe_event_id);
            if (!this.rows.has(id)) {
              this.rows.set(id, { ...values } as StripeWebhookEventEntity);
            }
            return Promise.resolve({});
          },
        };
        return builder;
      },
      findOne: (options: { where: { stripe_event_id: string } }) => {
        const row = this.rows.get(options.where.stripe_event_id);
        return Promise.resolve(row ? { ...row } : null);
      },
      save: (row: StripeWebhookEventEntity) => {
        this.rows.set(row.stripe_event_id, { ...row });
        return Promise.resolve(row);
      },
      update: (
        criteria: { stripe_event_id: string },
        patch: Partial<StripeWebhookEventEntity>,
      ) => {
        const row = this.rows.get(criteria.stripe_event_id);
        if (row) {
          Object.assign(row, patch);
        }
        return Promise.resolve({ affected: row ? 1 : 0 });
      },
    };
  }

  manager(): EntityManager {
    return {
      getRepository: () => this.repository(),
    } as unknown as EntityManager;
  }
}

const EVENT = {
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_1", metadata: { reservation_id: "7" } } },
};

const createFixture = () => {
  const store = new FakeEventStore();
  const email = vi.fn(() => Promise.resolve());
  const reservationWebhookService = {
    handleCheckoutCompleted: vi.fn(
      (
        _event: unknown,
        _manager: EntityManager,
        afterCommit: AfterCommitTask[],
      ) => {
        afterCommit.push(email);
        return Promise.resolve({ reservationId: 7 });
      },
    ),
  };
  const eventRepository = {
    ...store.repository(),
    manager: {
      transaction: <T>(run: (manager: EntityManager) => Promise<T>) =>
        store.transaction(run),
    },
  };
  const service = new WebhookService(
    eventRepository as never,
    reservationWebhookService as never,
    {} as never,
    {} as never,
  );
  return { store, service, reservationWebhookService, email };
};

describe("WebhookService lifecycle", () => {
  it("processes a new event once and marks it processed", async () => {
    const { store, service, reservationWebhookService, email } =
      createFixture();

    const result = await service.handleWebhook(EVENT);

    expect(result.duplicate).toBe(false);
    expect(
      reservationWebhookService.handleCheckoutCompleted,
    ).toHaveBeenCalledOnce();
    expect(email).toHaveBeenCalledOnce();
    expect(store.rows.get("evt_1")).toMatchObject({
      status: WEBHOOK_EVENT_STATUS.PROCESSED,
      attempts: 1,
      reservation_id: 7,
      last_error: null,
    });
  });

  it("skips an event that was already processed (idempotent)", async () => {
    const { service, reservationWebhookService, email } = createFixture();

    await service.handleWebhook(EVENT);
    const second = await service.handleWebhook(EVENT);

    expect(second.duplicate).toBe(true);
    expect(
      reservationWebhookService.handleCheckoutCompleted,
    ).toHaveBeenCalledOnce();
    expect(email).toHaveBeenCalledOnce();
  });

  it("marks a failing event as failed, rethrows (non-2xx) and reprocesses it on retry", async () => {
    const { store, service, reservationWebhookService, email } =
      createFixture();
    reservationWebhookService.handleCheckoutCompleted.mockImplementationOnce(
      () => Promise.reject(new Error("db down")),
    );

    await expect(service.handleWebhook(EVENT)).rejects.toThrow("db down");
    expect(store.rows.get("evt_1")).toMatchObject({
      status: WEBHOOK_EVENT_STATUS.FAILED,
      attempts: 1,
      last_error: "db down",
    });
    expect(email).not.toHaveBeenCalled();

    const retry = await service.handleWebhook(EVENT);

    expect(retry.duplicate).toBe(false);
    expect(
      reservationWebhookService.handleCheckoutCompleted,
    ).toHaveBeenCalledTimes(2);
    expect(store.rows.get("evt_1")).toMatchObject({
      status: WEBHOOK_EVENT_STATUS.PROCESSED,
      attempts: 2,
    });
    expect(email).toHaveBeenCalledOnce();
  });

  it("answers 409 while another delivery holds a fresh lease, and takes over a stale one", async () => {
    const { store, service, reservationWebhookService } = createFixture();
    store.rows.set("evt_1", {
      stripe_event_id: "evt_1",
      type: EVENT.type,
      status: WEBHOOK_EVENT_STATUS.PROCESSING,
      attempts: 1,
      processing_started_at: new Date(),
    } as StripeWebhookEventEntity);

    await expect(service.handleWebhook(EVENT)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      reservationWebhookService.handleCheckoutCompleted,
    ).not.toHaveBeenCalled();

    const stale = store.rows.get("evt_1");
    if (stale) {
      stale.processing_started_at = new Date(
        Date.now() - WEBHOOK_PROCESSING_LEASE_MS - 1000,
      );
    }
    await service.handleWebhook(EVENT);
    expect(
      reservationWebhookService.handleCheckoutCompleted,
    ).toHaveBeenCalledOnce();
    expect(store.rows.get("evt_1")?.status).toBe(
      WEBHOOK_EVENT_STATUS.PROCESSED,
    );
  });

  it("handles two simultaneous deliveries: exactly one processes, the other is skipped or told to retry", async () => {
    const { service, reservationWebhookService } = createFixture();

    const results = await Promise.allSettled([
      service.handleWebhook(EVENT),
      service.handleWebhook(EVENT),
    ]);

    expect(
      reservationWebhookService.handleCheckoutCompleted,
    ).toHaveBeenCalledOnce();
    const processedOnce = results.filter(
      result => result.status === "fulfilled" && !result.value.duplicate,
    );
    expect(processedOnce).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(ConflictException);
      }
    }
  });
});
