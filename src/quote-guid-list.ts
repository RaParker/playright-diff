import { readFile } from 'node:fs/promises';
import { isMissing } from './fs-helpers.js';

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

/** Header line naming the environment a GUID list was made from, e.g. `# environment: stg`. */
const environmentHeader = /^#\s*environment:\s*(\S+)\s*$/i;

/**
 * Reads a GUID list (TCAS format, one per line), such as testdata/quoteGuids-<environment>.txt.
 * @param path List file path.
 * @param expectedEnvironment Environment the run uses (e.g. `stg`); when given, a list whose
 * `# environment: <name>` header names another environment is refused. Lists without the header are not checked.
 * @returns Uppercase policy details IDs in file order; blank lines and `#` comment lines are skipped.
 * @throws When the file is missing or cannot be read, names another environment, or a line is not 32 hexadecimal
 * characters.
 */
export async function readQuoteGuidList(path: string, expectedEnvironment?: string): Promise<string[]> {
  const lines = (await readListFile(path, expectedEnvironment)).split(/\r?\n/);
  checkListEnvironment(path, lines, expectedEnvironment);
  return lines.flatMap((line, index) => {
    const guid = line.trim();
    if (guid.length === 0 || guid.startsWith('#')) {
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

/** Reads the list, explaining how to make one when it is missing. */
async function readListFile(path: string, environment: string | undefined): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      const forEnvironment = environment === undefined ? '' : ` -Environment ${environment}`;
      throw new Error(
        `No GUID list at ${path}. Make one from the environment's database with .\\Run-Project.ps1 -NewGuidList${forEnvironment}.`,
        { cause: error }
      );
    }

    throw error;
  }
}

/** Throws when the list's `# environment:` header names an environment other than the expected one. */
function checkListEnvironment(path: string, lines: string[], expected: string | undefined): void {
  const listEnvironment = lines
    .map((line) => environmentHeader.exec(line.trim())?.[1])
    .find((name) => name !== undefined);
  if (
    expected === undefined ||
    listEnvironment === undefined ||
    listEnvironment.toLowerCase() === expected.toLowerCase()
  ) {
    return;
  }

  throw new Error(
    `${path} lists ${listEnvironment} policies, but the run is against ${expected}: its policy IDs do not exist there. ` +
      'Point QUOTE_GUID_LIST_PATH at the list for this environment (testdata/quoteGuids-<environment>.txt).'
  );
}
