const oneSecondMs = 1000;
const oneMinuteMs = 60 * oneSecondMs;
const oneHourMs = 60 * oneMinuteMs;
const oneDayMs = 24 * oneHourMs;

/** Milliseconds per interval suffix; no suffix means milliseconds. */
const suffixMs: Record<string, number> = { '': 1, s: oneSecondMs, m: oneMinuteMs, h: oneHourMs, d: oneDayMs };
/** Shortest interval accepted, in milliseconds. */
const minimumMs = 1;
/** Longest interval accepted, in milliseconds. */
const maximumMs = 8 * oneHourMs;
/** A whole number of up to 8 digits with an optional unit suffix. */
const intervalPattern = /^(-?\d{1,8})([dhms]?)$/;

/**
 * Converts an interval such as `45s`, `2m`, `1h` or `5000` to milliseconds. Matches `intervalToMs` in
 * `@avantia/client-and-server-utilities` with its default bounds, which this project cannot depend on because the
 * package ships TypeScript sources without declarations that do not compile under this project's strict settings.
 * @param interval A whole number with an optional suffix: `d` (days), `h` (hours), `m` (minutes) or `s` (seconds);
 * without one it is milliseconds.
 * @returns The interval in milliseconds.
 * @throws When the format is invalid, or the interval is under 1 ms or over 8 hours.
 */
export function intervalToMs(interval: string): number {
  const match = intervalPattern.exec(interval);
  const multiplier = suffixMs[match?.[2] ?? ''];
  if (match === null || match[1] === undefined || multiplier === undefined) {
    throw new Error(
      `The 'interval' must be a number and optional suffix: [d]ay, [h]our, [m]inute, [s]econds. Instead got '${interval}'.`
    );
  }

  const milliseconds = Number.parseInt(match[1], 10) * multiplier;
  if (milliseconds < minimumMs) {
    throw new Error(`The 'interval' cannot be less than ${minimumMs}ms. Instead got '${interval}'`);
  }

  if (milliseconds > maximumMs) {
    throw new Error(`The 'interval' cannot be greater than ${maximumMs}ms. Instead got '${interval}'`);
  }

  return milliseconds;
}
