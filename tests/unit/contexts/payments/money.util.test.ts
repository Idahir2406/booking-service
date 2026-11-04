import {
  centsToDecimal,
  formatCents,
  formatMoney,
  MoneyError,
  multiplyCents,
  normalizeRate,
  parseToCents,
  percentOfCents,
  roundHalfUp,
  sumCents,
  toCents,
} from "@/src/contexts/payments/utils/money.util";

describe("money utils (integer cents, half-up)", () => {
  it("rounds half-up, symmetric for negatives", () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3); // not banker's rounding
    expect(roundHalfUp(2.4999)).toBe(2);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(-0.4)).toBe(0);
    expect(Object.is(roundHalfUp(-0.4), -0)).toBe(false);
  });

  it("parses legacy decimals without float artifacts", () => {
    expect(parseToCents("12.34")).toBe(1234);
    expect(parseToCents(1.005)).toBe(101); // 1.005*100 = 100.4999... in floats
    expect(parseToCents(0.1 + 0.2)).toBe(30);
    expect(parseToCents("12,5")).toBe(1250);
    expect(parseToCents(200)).toBe(20_000);
    expect(parseToCents(null)).toBeNull();
    expect(parseToCents("")).toBeNull();
    expect(toCents(null)).toBe(0);
    expect(() => parseToCents("abc")).toThrow(MoneyError);
  });

  it("formats cents", () => {
    expect(formatCents(123_456)).toBe("1234.56");
    expect(formatCents(-5)).toBe("-0.05");
    expect(formatCents(0)).toBe("0.00");
    expect(centsToDecimal(1999)).toBe(19.99);
    expect(formatMoney(123_456, "eur").replaceAll(/\s/g, " ")).toMatch(
      /1\.?234,56/,
    );
    expect(() => formatCents(1.5)).toThrow(MoneyError);
  });

  it("computes percentages on cents with basis points (half-up)", () => {
    expect(percentOfCents(10_000, 0.12)).toBe(1200);
    expect(percentOfCents(1005, 0.12)).toBe(121); // 120.6
    expect(percentOfCents(1004, 0.12)).toBe(120); // 120.48
    expect(percentOfCents(125, 0.1)).toBe(13); // 12.5 -> 13
    expect(percentOfCents(0, 0.12)).toBe(0);
    expect(percentOfCents(-1005, 0.12)).toBe(-121);
  });

  it("validates rates (0..1, 4 decimals)", () => {
    expect(normalizeRate("0.12")).toBe(0.12);
    expect(normalizeRate(0.123_456)).toBe(0.1235);
    expect(() => normalizeRate(12)).toThrow(MoneyError);
    expect(() => normalizeRate(-0.1)).toThrow(MoneyError);
  });

  it("sums and multiplies cents safely", () => {
    expect(sumCents([100, 250, -50])).toBe(300);
    expect(() => sumCents([1, 0.5])).toThrow(MoneyError);
    expect(multiplyCents(1999, 3)).toBe(5997);
    expect(multiplyCents(333, 1.5)).toBe(500); // 499.5 -> 500
  });
});
