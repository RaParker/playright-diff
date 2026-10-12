export const color = {
  Gray(text: string): string {
    return `\u001b[90m${text}\u001b[0m`;
  },
  Red(text: string): string {
    return `\u001b[31m${text}\u001b[0m`;
  },
  Green(text: string): string {
    return `\u001b[32m${text}\u001b[0m`;
  },
  Yellow(text: string): string {
    return `\u001b[33m${text}\u001b[0m`;
  },
  Cyan(text: string): string {
    return `\u001b[36m${text}\u001b[0m`;
  }
};

/** Yellow for a journey validation failure (the site rejected the answers), otherwise red. */
export function failureColor(validation: boolean): (text: string) => string {
  return validation ? color.Yellow : color.Red;
}
