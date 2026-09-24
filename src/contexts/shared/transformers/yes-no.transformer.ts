import type { ValueTransformer } from "typeorm";

// Legacy PHP flags are TEXT 'S' (sí) / 'N' (no). Only use on pure S/N columns;
// anything that is not 'S' (including NULL) reads as false.
export const YES_NO = {
  YES: "S",
  NO: "N",
} as const;

export type YesNoValue = (typeof YES_NO)[keyof typeof YES_NO];

export const yesNoTransformer: ValueTransformer = {
  from: (value: unknown): boolean => value === YES_NO.YES,
  to: (value: unknown): unknown => {
    if (typeof value === "boolean") {
      return value ? YES_NO.YES : YES_NO.NO;
    }
    if (value === null || value === undefined) {
      return YES_NO.NO;
    }
    // Pass raw strings / FindOperator through untouched
    return value;
  },
};
