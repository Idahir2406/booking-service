import type { ValueTransformer } from "typeorm";

// Legacy PHP stores multi-selects as comma-separated ids ("14,15,7"), no spaces,
// in click order (not sorted), and "" when empty. Keep that exact format on write.
export function parseCsvIds(value: unknown): number[] {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }

  const ids = value
    .split(",")
    .map(part => Number.parseInt(part.trim(), 10))
    .filter(id => Number.isInteger(id) && id > 0);

  return [...new Set(ids)];
}

export function serializeCsvIds(ids: readonly number[]): string {
  return [...new Set(ids.filter(id => Number.isInteger(id) && id > 0))].join(
    ",",
  );
}

export const csvIdsTransformer: ValueTransformer = {
  from: (value: unknown): number[] => parseCsvIds(value),
  to: (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return serializeCsvIds(value as number[]);
    }
    // null/undefined: PHP writes "" for an empty selection, never NULL
    if (value === null || value === undefined) {
      return "";
    }
    // Pass anything else (raw string, FindOperator) through untouched
    return value;
  },
};
