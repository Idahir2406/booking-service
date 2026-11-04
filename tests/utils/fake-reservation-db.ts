import type { EntityManager } from "typeorm";

import { AvailabilityEntity } from "@/src/contexts/availability/entities/availability.entity";
import { ReservationEntity } from "@/src/contexts/reservations/entities/reservation.entity";
import { isReservationBlockingInventory } from "@/src/contexts/reservations/utils/reservation-policy.util";

import { FakeEntityStore, matchesWhere } from "./fake-entity-store";

/** A failed transaction must not stall the ones queued after it. */
function keepQueueAlive(): void {
  // intentionally empty: the error is surfaced to the caller of transaction()
}

/**
 * Minimal in-memory stand-in for the MariaDB behaviour the reservation
 * service relies on: transactions are serialized (as rows locked with
 * SELECT ... FOR UPDATE on the same nights would be) and rolled back on
 * error. Only the query shapes used by ReservationService are supported.
 */
export interface FakeAvailabilityRow {
  id: number;
  site_id: number;
  room_id: number;
  date: string;
  is_available: boolean;
  min_nights: number;
  max_nights: number;
}

type Params = Record<string, unknown>;

interface FindOneOptions {
  where: Record<string, unknown>;
}

function isBlocking(reservation: ReservationEntity, now: Date): boolean {
  return isReservationBlockingInventory(reservation, now);
}

function matchAvailability(
  rows: FakeAvailabilityRow[],
  params: Params,
): FakeAvailabilityRow[] {
  return rows.filter(
    row =>
      (params.siteId === undefined || row.site_id === params.siteId) &&
      (params.roomId === undefined || row.room_id === params.roomId) &&
      (params.firstNight === undefined ||
        row.date >= String(params.firstNight)) &&
      (params.lastNight === undefined || row.date <= String(params.lastNight)),
  );
}

export class FakeReservationDb {
  availability: FakeAvailabilityRow[] = [];
  reservations = new Map<number, ReservationEntity>();
  /** F1 payments entities (price lines, payments, refunds, snapshots, audit). */
  store = new FakeEntityStore();
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  seedNights(
    siteId: number,
    roomId: number,
    dates: string[],
    available = true,
  ) {
    for (const date of dates) {
      this.availability.push({
        id: this.availability.length + 1,
        site_id: siteId,
        room_id: roomId,
        date,
        is_available: available,
        min_nights: 1,
        max_nights: 30,
      });
    }
  }

  seedReservation(reservation: ReservationEntity): ReservationEntity {
    const id = reservation.id || this.nextId;
    this.nextId = Math.max(this.nextId, id + 1);
    const stored = Object.assign(new ReservationEntity(), reservation, { id });
    this.reservations.set(id, stored);
    return stored;
  }

  /** Serialized transaction with snapshot rollback. */
  transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const snapshotAvailability = this.availability.map(row => ({ ...row }));
      const snapshotReservations = new Map(
        [...this.reservations].map(([id, value]) => [
          id,
          Object.assign(new ReservationEntity(), value),
        ]),
      );
      const snapshotStore = this.store.snapshot();
      try {
        return await run(this.manager());
      } catch (error) {
        this.availability = snapshotAvailability;
        this.reservations = snapshotReservations;
        this.store.restore(snapshotStore);
        throw error;
      }
    });
    this.queue = next.catch(keepQueueAlive);
    return next;
  }

  manager(): EntityManager {
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === AvailabilityEntity) {
          return this.availabilityRepository();
        }
        if (entity === ReservationEntity) {
          return this.reservationRepository();
        }
        return this.store.repository(entity as abstract new () => object);
      },
      transaction: <T>(run: (m: EntityManager) => Promise<T>) =>
        this.transaction(run),
    };
    return manager as unknown as EntityManager;
  }

  private availabilityRepository() {
    return {
      createQueryBuilder: () => {
        const params: Params = {};
        let patch: Partial<FakeAvailabilityRow> = {};
        const builder = {
          setLock: () => builder,
          update: () => builder,
          set: (value: Partial<FakeAvailabilityRow>) => {
            patch = value;
            return builder;
          },
          where: (_sql: string, value: Params) => {
            Object.assign(params, value);
            return builder;
          },
          andWhere: (_sql: string, value: Params) => {
            Object.assign(params, value);
            return builder;
          },
          orderBy: () => builder,
          getMany: async () => {
            // Yield so a concurrent caller would interleave without the lock.
            await new Promise(resolve => setTimeout(resolve, 1));
            return matchAvailability(this.availability, params).map(row => ({
              ...row,
            }));
          },
          execute: () => {
            for (const row of matchAvailability(this.availability, params)) {
              Object.assign(row, patch);
            }
            return Promise.resolve({ affected: 1 });
          },
        };
        return builder;
      },
      update: (
        criteria: { id: { value: number[] } },
        patch: Partial<FakeAvailabilityRow>,
      ) => {
        for (const row of this.availability) {
          if (criteria.id.value.includes(row.id)) {
            Object.assign(row, patch);
          }
        }
        return Promise.resolve({ affected: criteria.id.value.length });
      },
    };
  }

  private reservationRepository() {
    return {
      create: (payload: Partial<ReservationEntity>) =>
        Object.assign(new ReservationEntity(), { refund_seq: 0 }, payload),
      save: (entity: ReservationEntity) => {
        if (!entity.id) {
          entity.id = this.nextId;
          this.nextId += 1;
        }
        this.reservations.set(
          entity.id,
          Object.assign(new ReservationEntity(), entity),
        );
        return Promise.resolve(entity);
      },
      findOne: (options: FindOneOptions) => {
        const found = [...this.reservations.values()].find(row =>
          matchesWhere(
            row as unknown as Record<string, unknown>,
            options.where,
          ),
        );
        return Promise.resolve(
          found ? Object.assign(new ReservationEntity(), found) : null,
        );
      },
      update: (
        criteria: number | { id: number },
        patch: Partial<ReservationEntity>,
      ) => {
        const id = typeof criteria === "number" ? criteria : criteria.id;
        const row = this.reservations.get(id);
        if (row) {
          Object.assign(row, patch);
        }
        return Promise.resolve({ affected: row ? 1 : 0 });
      },
      createQueryBuilder: () => {
        const params: Params = {};
        const builder = {
          where: (_sql: string, value: Params) => {
            Object.assign(params, value);
            return builder;
          },
          andWhere: (_sql: string, value: Params) => {
            Object.assign(params, value);
            return builder;
          },
          getOne: () => {
            const now = new Date();
            const hit = [...this.reservations.values()].find(
              row =>
                row.site_id === params.site_id &&
                row.room_id === params.room_id &&
                row.checkin < String(params.checkout) &&
                row.checkout > String(params.checkin) &&
                row.id !== params.excludeReservationId &&
                isBlocking(row, now),
            );
            return Promise.resolve(hit ?? null);
          },
          getMany: () => {
            const hits = [...this.reservations.values()].filter(
              row =>
                row.site_id === params.site_id &&
                row.room_id === params.room_id &&
                String(row.checkin) < String(params.checkout) &&
                String(row.checkout) > String(params.checkin) &&
                row.id !== params.excludeReservationId &&
                row.status !== "cancelled",
            );
            return Promise.resolve(hits);
          },
        };
        return builder;
      },
    };
  }
}
