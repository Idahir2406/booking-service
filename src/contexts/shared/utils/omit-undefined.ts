export const omit_undefined = <T extends Record<string, unknown>>(
  record: T,
): Partial<T> => {
  const entries = Object.entries(record).filter(
    ([, value]) => value !== undefined,
  );
  return Object.fromEntries(entries) as Partial<T>;
};
