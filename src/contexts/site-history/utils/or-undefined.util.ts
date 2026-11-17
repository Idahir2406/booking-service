/**
 * Best-effort read for the accommodation history: a failing "before" read
 * must never block the host's save, it only leaves that side of the diff
 * empty.
 */
export async function orUndefined<T>(
  promise: Promise<T>,
): Promise<T | undefined> {
  try {
    return await promise;
  } catch {
    return;
  }
}
