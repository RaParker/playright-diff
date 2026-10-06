import assert from 'node:assert/strict';

/**
 * Asserts that each expected line was logged in grey, in the given order (other lines may come in between).
 * @param {import('node:test').Mock<typeof console.log>} log Mock of `console.log`.
 * @param {string[]} expected Log lines, without the grey colour codes.
 */
export function assertGreyLogsInOrder(log, expected) {
  const lines = log.mock.calls.map((call) => String(call.arguments[0]));
  let from = 0;
  for (const line of expected) {
    const index = lines.indexOf(`\u001b[90m${line}\u001b[0m`, from);
    assert.ok(index >= 0, `Expected grey log line ${JSON.stringify(line)} in order; logged:\n${lines.join('\n')}`);
    from = index + 1;
  }
}
