import type { ValueTransformer } from "typeorm";

/** mysql2 returns DECIMAL as string; expose it as number (null-safe). */
export const decimalTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  },
};
