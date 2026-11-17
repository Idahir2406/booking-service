import { FindOperator } from "typeorm";

import { PaymentEntity } from "@/src/contexts/payments/entities/payment.entity";
import { RefundEntity } from "@/src/contexts/payments/entities/refund.entity";
import { ReservationSnapshotEntity } from "@/src/contexts/payments/entities/reservation-snapshot.entity";

type Row = Record<string, unknown>;
type EntityClass = abstract new () => object;
type Where = Row | Row[];

interface FindOptions {
  where?: Where;
  order?: Record<string, "ASC" | "DESC">;
}

/** Unique indexes enforced like MariaDB would (ER_DUP_ENTRY). */
const UNIQUE_KEYS = new Map<EntityClass, string[][]>([
  [PaymentEntity, [["idempotency_key"]]],
  [RefundEntity, [["idempotency_key"], ["stripe_refund_id"]]],
  [ReservationSnapshotEntity, [["reservation_id", "version"]]],
]);

function matchValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof FindOperator) {
    const value: unknown = expected.value;
    switch (expected.type) {
      case "in": {
        return (value as unknown[]).includes(actual);
      }
      case "not": {
        return !matchValue(actual, value);
      }
      case "isNull": {
        return actual === null || actual === undefined;
      }
      case "lessThan":
      case "lessThanOrEqual": {
        if (actual === null || actual === undefined) {
          return false;
        }
        const left = new Date(actual as Date | string | number).getTime();
        const right = new Date(value as Date | string | number).getTime();
        return expected.type === "lessThan" ? left < right : left <= right;
      }
      default: {
        throw new Error(
          `FakeEntityStore: unsupported operator ${expected.type}`,
        );
      }
    }
  }
  return actual === expected;
}

export function matchesWhere(row: Row, where: Where | undefined): boolean {
  if (!where) {
    return true;
  }
  if (Array.isArray(where)) {
    return where.some(branch => matchesWhere(row, branch));
  }
  return Object.entries(where).every(([key, expected]) =>
    matchValue(row[key], expected),
  );
}

function sortRows(rows: Row[], order?: FindOptions["order"]): Row[] {
  if (!order) {
    return rows;
  }
  const [[key, direction] = ["id", "ASC"]] = Object.entries(order);
  return [...rows].sort((a, b) => {
    const left = Number(a[key]);
    const right = Number(b[key]);
    return direction === "DESC" ? right - left : left - right;
  });
}

/**
 * Generic in-memory repository store for the F1 payments entities. Supports
 * the repository methods the ledger/snapshot/audit services use, unique
 * indexes and snapshot/restore for transaction rollback.
 */
export class FakeEntityStore {
  private tables = new Map<EntityClass, Row[]>();
  private ids = new Map<EntityClass, number>();

  rows<T>(entity: abstract new () => T): T[] {
    return (this.tables.get(entity as EntityClass) ?? []) as T[];
  }

  snapshot(): Map<EntityClass, Row[]> {
    return new Map(
      [...this.tables].map(([entity, rows]) => [
        entity,
        rows.map(row => ({ ...row })),
      ]),
    );
  }

  restore(state: Map<EntityClass, Row[]>): void {
    this.tables = state;
  }

  repository(entity: EntityClass) {
    const table = () => {
      let rows = this.tables.get(entity);
      if (!rows) {
        rows = [];
        this.tables.set(entity, rows);
      }
      return rows;
    };
    const nextId = () => {
      const id = (this.ids.get(entity) ?? 0) + 1;
      this.ids.set(entity, id);
      return id;
    };
    const assertUnique = (row: Row) => {
      for (const keys of UNIQUE_KEYS.get(entity) ?? []) {
        if (keys.some(key => row[key] === null || row[key] === undefined)) {
          continue;
        }
        const clash = table().find(
          other =>
            other !== row &&
            other.id !== row.id &&
            keys.every(key => other[key] === row[key]),
        );
        if (clash) {
          throw Object.assign(
            new Error(`Duplicate entry for ${keys.join(",")}`),
            {
              code: "ER_DUP_ENTRY",
              errno: 1062,
            },
          );
        }
      }
    };
    const saveOne = (value: Row): Row => {
      const now = new Date();
      if (value.id === undefined || value.id === null) {
        assertUnique(value);
        value.id = nextId();
        value.created_at ??= now;
        value.updated_at = now;
        table().push({ ...value });
        return value;
      }
      assertUnique(value);
      value.updated_at = now;
      const index = table().findIndex(row => row.id === value.id);
      if (index === -1) {
        table().push({ ...value });
      } else {
        table()[index] = { ...table()[index], ...value };
      }
      return value;
    };
    const clone = (row: Row) =>
      Object.assign(
        Object.create(
          (entity as unknown as { prototype: object }).prototype,
        ) as Row,
        row,
      );

    return {
      create: (value: Row) => clone(value),
      /** TypeORM preload: existing row by id merged with the patch, or undefined. */
      preload: (value: Row) => {
        const hit = table().find(row => row.id === value.id);
        return Promise.resolve(hit ? clone({ ...hit, ...value }) : undefined);
      },
      save: (value: Row | Row[]) =>
        Promise.resolve(
          Array.isArray(value)
            ? value.map(item => saveOne(item))
            : saveOne(value),
        ),
      insert: (value: Row) => {
        saveOne({ ...value });
        return Promise.resolve({ identifiers: [] });
      },
      findOne: (options: FindOptions) => {
        const hit = sortRows(
          table().filter(row => matchesWhere(row, options.where)),
          options.order,
        ).at(0);
        return Promise.resolve(hit ? clone(hit) : null);
      },
      find: (options: FindOptions = {}) =>
        Promise.resolve(
          sortRows(
            table().filter(row => matchesWhere(row, options.where)),
            options.order,
          ).map(row => clone(row)),
        ),
      count: (options: FindOptions = {}) =>
        Promise.resolve(
          table().filter(row => matchesWhere(row, options.where)).length,
        ),
      maximum: (column: string, where: Row) => {
        const values = table()
          .filter(row => matchesWhere(row, where))
          .map(row => Number(row[column]));
        return Promise.resolve(values.length > 0 ? Math.max(...values) : null);
      },
      update: (criteria: Row, patch: Row) => {
        let affected = 0;
        for (const row of table()) {
          if (matchesWhere(row, criteria)) {
            Object.assign(row, patch);
            affected += 1;
          }
        }
        return Promise.resolve({ affected });
      },
    };
  }
}
