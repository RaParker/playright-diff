/** Device pixels per CSS pixel when `SCREENSHOT_SCALE` is not set: 1.0, i.e. 100%. */
export const defaultScreenshotScale = 1;

/** Smallest scale accepted: below 50% text is too small for OCR to read. */
const minimumScreenshotScale = 0.5;
/** Largest scale accepted: above 400% a long quote page passes the comparison's 40 million pixel limit. */
const maximumScreenshotScale = 4;

/**
 * Checks a screenshot scale: device pixels per CSS pixel, so 1.0 is 100% and 1.5 is 150%.
 * @param value The scale.
 * @param name Name used in the error message.
 * @returns The scale.
 * @throws When it is not a number from 0.5 to 4.
 */
export function checkScreenshotScale(value: number, name: string): number {
  if (!Number.isFinite(value) || value < minimumScreenshotScale || value > maximumScreenshotScale) {
    throw new Error(`${name} must be a number from ${minimumScreenshotScale} to ${maximumScreenshotScale}.`);
  }

  return value;
}

/**
 * Reads the `SCREENSHOT_SCALE` setting: device pixels per CSS pixel, so `1.0` is 100% and `1.5` is 150%. Text drawn at
 * a higher scale has more pixels, so OCR misreads it less; the layout is the same at every scale.
 * @param value The setting, or `undefined` when not set.
 * @returns The scale, or {@link defaultScreenshotScale} when not set.
 * @throws When it is not a plain decimal number (such as `1`, `1.0` or `1.5`) from 0.5 to 4.
 */
export function parseScreenshotScale(value: string | undefined): number {
  if (value === undefined) {
    return defaultScreenshotScale;
  }

  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`SCREENSHOT_SCALE must be a decimal number such as 1.0 (100%) or 1.5 (150%), not "${value}".`);
  }

  return checkScreenshotScale(Number(trimmed), 'SCREENSHOT_SCALE');
}
