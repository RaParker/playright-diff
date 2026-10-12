/**
 * Runs a task for each item with at most `concurrency` tasks in flight, starting items in list order. Each runner takes
 * the next unclaimed index; Node runs this code on one thread, so claiming an index cannot race.
 * @param items Items to process.
 * @param concurrency Most tasks running at once (a positive integer); 1 runs the items one after another.
 * @param task Runs one item, given its index in `items`. A rejection stops its runner from taking more items.
 * @returns Once every started task has settled.
 * @throws When `concurrency` is not a positive integer, or the first task rejection after all runners stop.
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
 * @throws When it is not a positive safe integer.
 */
export function validateConcurrency(concurrency: number): void {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer.');
  }
}
