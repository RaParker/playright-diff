import { AsyncLocalStorage } from 'node:async_hooks';
import { format } from 'node:util';

/** Console methods that get a line prefix while {@link withPrefixedConsole} runs. */
const prefixedMethods = ['log', 'error', 'warn'] as const;

/** ANSI colour (SGR) escape sequences, as `color.*` writes them. */
const colourCodePattern = new RegExp(`${String.fromCharCode(27)}\\[\\d+(?:;\\d+)*m`, 'g');
/** ANSI sequence that ends any colour. */
const colourReset = '\u001b[0m';

/** The prefix of the task whose asynchronous work is running, if any. */
const prefixStorage = new AsyncLocalStorage<string>();

/**
 * Runs a task while `console.log`, `console.error` and `console.warn` put the current {@link runWithLogPrefix} prefix
 * before every line they print, so the output of tasks running at the same time can be told apart. Lines logged
 * outside any prefixed task print unchanged. The original methods are restored when the task settles.
 * @param task Work whose concurrent tasks call {@link runWithLogPrefix}.
 * @returns The task's result.
 */
export async function withPrefixedConsole<T>(task: () => Promise<T>): Promise<T> {
  const originals = prefixedMethods.map((method) => [method, console[method]] as const);
  for (const [method, original] of originals) {
    console[method] = (...args: unknown[]) => {
      const prefix = prefixStorage.getStore();
      if (prefix === undefined) {
        original(...args);
        return;
      }

      original(prefixLines(prefix, format(...args)));
    };
  }

  try {
    return await task();
  } finally {
    for (const [method, original] of originals) {
      console[method] = original;
    }
  }
}

/**
 * Runs a task with a log prefix that {@link withPrefixedConsole} adds to everything the task logs, including logs from
 * the asynchronous work it starts.
 * @param prefix Text shown before each line, such as `[42/1300 ABCD1234]`.
 * @param task Work to run.
 * @returns The task's result.
 */
export function runWithLogPrefix<T>(prefix: string, task: () => Promise<T>): Promise<T> {
  return prefixStorage.run(prefix, task);
}

/**
 * Puts the prefix before each line. A colour left open from an earlier line (as `color.*` wraps a whole multi-line
 * message) is reset before the prefix and reopened after it, so the prefix itself is never coloured.
 */
function prefixLines(prefix: string, text: string): string {
  let openColour: string | undefined;
  return text
    .split('\n')
    .map((line) => {
      const prefixed = openColour === undefined ? `${prefix} ${line}` : `${colourReset}${prefix} ${openColour}${line}`;
      for (const [code] of line.matchAll(colourCodePattern)) {
        openColour = code === colourReset ? undefined : code;
      }

      return prefixed;
    })
    .join('\n');
}
