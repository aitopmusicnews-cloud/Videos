/**
 * Poll an async producer until a predicate is satisfied or a deadline is hit.
 * Uses exponential backoff so a fast-completing task doesn't pay a fixed
 * 3-second floor, and a slow one doesn't hammer the upstream every 3s.
 */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (value: T) => boolean,
  opts: {
    timeoutMs: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    multiplier?: number;
    label?: string;
  }
): Promise<T> {
  const initial = opts.initialDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 10_000;
  const mult = opts.multiplier ?? 1.6;
  const label = opts.label ?? "poll";
  const deadline = Date.now() + opts.timeoutMs;
  let delay = initial;
  while (true) {
    const value = await fn();
    if (done(value)) return value;
    if (Date.now() + delay >= deadline) {
      throw new Error(`${label} timed out after ${opts.timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(max, Math.floor(delay * mult));
  }
}
