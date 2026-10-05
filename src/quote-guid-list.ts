import { readFile } from 'node:fs/promises';

/** Number of policies processed when no maxCount or GUID is given, matching mrp-and-quote. */
export const defaultQuoteGuidCount = 250;

/**
 * Checks whether a value is a TCAS-format GUID (32 hexadecimal characters, no dashes).
 * @param value Value to check, such as a quote-pages selector.
 * @returns `true` for a TCAS-format GUID, in either case.
 */
export function isQuoteGuid(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}

/**
 * Reads a GUID list (TCAS format, one per line), as used by mrp-and-quote's testdata/quoteGuids.txt.
 * @param path List file path.
 * @returns Uppercase policy details IDs in file order; blank lines are skipped.
 * @throws When the file cannot be read or a line is not 32 hexadecimal characters.
 */
export async function readQuoteGuidList(path: string): Promise<string[]> {
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
  return lines.flatMap((line, index) => {
    const guid = line.trim();
    if (guid.length === 0) {
      return [];
    }

    if (!isQuoteGuid(guid)) {
      throw new Error(`${path} line ${index + 1}: "${guid}" is not a UUID with dashes removed.`);
    }

    return [guid.toUpperCase()];
  });
}

/**
 * Narrows a GUID list to the first maxCount entries or to one matching GUID.
 * @param guids Policy details IDs from the list.
 * @param selector Optional maxCount (non-negative integer) or TCAS-format GUID (case-insensitive).
 * @returns The selected IDs; the first {@link defaultQuoteGuidCount} when selector is omitted.
 * @throws When selector is neither form, or a GUID matches nothing in the list.
 */
export function selectQuoteGuids(guids: string[], selector?: string): string[] {
  if (selector === undefined) {
    return guids.slice(0, defaultQuoteGuidCount);
  }

  if (isQuoteGuid(selector)) {
    const matches = guids.filter((guid) => guid === selector.toUpperCase());
    if (matches.length === 0) {
      throw new Error(`No entry in the GUID list matches ${selector}.`);
    }

    return matches;
  }

  if (!/^\d+$/.test(selector)) {
    throw new Error(`"${selector}" is neither a non-negative maxCount nor a quote GUID.`);
  }

  return guids.slice(0, Number(selector));
}
