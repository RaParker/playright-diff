/** Most tasks {@link runConcurrently} allows at once, so a typo cannot launch hundreds of browsers. */
export const maxConcurrency = 100;

/**
 * Runs a task for each item with at most `concurrency` tasks in flight, starting items in list order. Each runner takes
 * the next unclaimed index; Node runs this code on one thread, so claiming an index cannot race.
 * @param items Items to process.
 * @param concurrency Most tasks running at once (an integer from 1 to {@link maxConcurrency}); 1 runs the items one
 * after another.
 * @param task Runs one item, given its index in `items`. A rejection stops its runner from taking more items.
 * @returns Once every started task has settled.
 * @throws When `concurrency` is out of range, or the first task rejection after all runners stop.
 */
export async function runConcurrently<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>
): Promise<void> {
  validateConcurrency(concurrency);
  let next = 0;
  const runner = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      await task(items[index] as T, index);
    }
  };

  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected !== undefined) {
    throw rejected.reason;
  }
}

/**
 * Checks a concurrency setting.
 * @param concurrency Most tasks running at once.
 * @throws When it is not an integer from 1 to {@link maxConcurrency}.
 */
export function validateConcurrency(concurrency: number): void {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > maxConcurrency) {
    throw new Error(`concurrency must be an integer from 1 to ${maxConcurrency}.`);
  }
}

/**
 * Creates a runner that, for each key, runs tasks one at a time until one succeeds, then runs later tasks for that key
 * at once. Suits a first use that fills a shared cache (such as downloaded OCR language data): a failed first use lets
 * the next one try alone, rather than releasing every waiting task to fill the cache at the same time.
 * @returns A function that runs a task under the given key, resolving or rejecting as the task does.
 */
export function createSerialisedUntilSuccess(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const succeeded = new Set<string>();
  /** Settles when the attempt running alone for a key settles; absent when none is running. */
  const attempts = new Map<string, Promise<void>>();
  return async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    while (!succeeded.has(key)) {
      const running = attempts.get(key);
      if (running === undefined) {
        // No attempt is running, so this task becomes it; waiting tasks retry once it settles.
        const attempt = task();
        attempts.set(
          key,
          attempt
            .then(
              () => {
                succeeded.add(key);
              },
              () => undefined
            )
            .finally(() => attempts.delete(key))
        );
        return attempt;
      }

      await running;
    }

    return task();
  };
}
