export const color = {
  Gray(text: string): string {
    return `\u001b[90m${text}\u001b[0m`;
  },
  Red(text: string): string {
    return `\u001b[31m${text}\u001b[0m`;
  }
};
