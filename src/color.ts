/**
 * Colours console text with ANSI codes, unless the `NO_COLOR` environment variable is set to a non-empty value (see
 * https://no-color.org), for example when saving a run's output to a log file.
 */
export const color = {
  Gray: (text: string): string => paint(90, text),
  Red: (text: string): string => paint(31, text),
  Green: (text: string): string => paint(32, text),
  Yellow: (text: string): string => paint(33, text),
  Cyan: (text: string): string => paint(36, text)
};

/**
 * Picks the colour for a failure message.
 * @param validation True when the failure is a journey validation failure (the site rejected the answers).
 * @returns A function that colours text yellow for a validation failure, otherwise red.
 */
export function failureColor(validation: boolean): (text: string) => string {
  return validation ? color.Yellow : color.Red;
}

function paint(code: number, text: string): string {
  return (process.env['NO_COLOR'] ?? '').length > 0 ? text : `\u001b[${code}m${text}\u001b[0m`;
}
