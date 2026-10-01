import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('dist/quote-page.js');
const settings = [
  'MRP_AND_QUOTE_OUTPUT_DIR',
  'QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE',
  'QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE'
];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'quote-validation-'));
  await writeFile(
    join(directory, 'ABCDEF1234567890ABCDEF1234567890-42-mrp.json'),
    JSON.stringify({ '//artemisQuotGuid': 'guid' })
  );
  const env = { ...process.env };
  for (const name of settings) {
    delete env[name];
  }

  Object.assign(env, {
    MRP_AND_QUOTE_OUTPUT_DIR: directory,
    QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE: 'http://127.0.0.1:1/nhi/{artemisQuotGuid}',
    QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE: 'http://127.0.0.1:1/tcas/{policyDetailsId}/{historyId}'
  });
  return { directory, env };
}

async function run(directory, env, args = ['ABCDEF1234567890ABCDEF1234567890', '42', '--no-ocr']) {
  const child = spawn(process.execPath, [script, ...args], { cwd: directory, env });
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', resolveExit);
  });
  return { code, output };
}

const cases = [
  ['missing arguments', [], /Usage:/],
  ['path traversal', ['../policy', '42'], /policyDetailsId must/],
  ['dashed UUID', ['ABCDEF12-3456-7890-ABCD-EF1234567890', '42'], /policyDetailsId must/],
  ['short UUID', ['ABCDEF1234567890ABCDEF123456789', '42'], /policyDetailsId must/],
  ['long UUID', ['ABCDEF1234567890ABCDEF12345678900', '42'], /policyDetailsId must/],
  ['non-hexadecimal UUID', ['ZBCDEF1234567890ABCDEF1234567890', '42'], /policyDetailsId must/],
  ['fractional history', ['ABCDEF1234567890ABCDEF1234567890', '1.5'], /historyId must/],
  ['negative history', ['--', 'ABCDEF1234567890ABCDEF1234567890', '-1'], /historyId must/],
  ['unsafe history', ['ABCDEF1234567890ABCDEF1234567890', '9007199254740992'], /historyId must/],
  ['missing MRP file', ['11111111111111111111111111111111', '42'], /ENOENT/]
];
for (const [name, args, expected] of cases) {
  test(`quote-page rejects ${name} before writing output`, async () => {
    const { directory, env } = await fixture();
    const result = await run(directory, env, args);
    assert.notEqual(result.code, 0);
    assert.match(result.output, expected);
    assert.deepEqual(await readdir(directory), ['ABCDEF1234567890ABCDEF1234567890-42-mrp.json']);
  });
}

for (const name of settings) {
  test(`quote-page reports missing ${name}`, async () => {
    const { directory, env } = await fixture();
    delete env[name];
    const result = await run(directory, env);
    assert.notEqual(result.code, 0);
    assert.ok(result.output.includes(`${name} must be configured`));
    assert.deepEqual(await readdir(directory), ['ABCDEF1234567890ABCDEF1234567890-42-mrp.json']);
  });
}

for (const [name, content, expected] of [
  ['malformed JSON', '{', /JSON/],
  ['missing GUID', '{}', /must contain/],
  ['null MRP', 'null', /must contain/],
  ['numeric GUID', '{"//artemisQuotGuid":42}', /non-empty string/],
  ['blank GUID', '{"//artemisQuotGuid":"  "}', /non-empty string/]
]) {
  test(`quote-page rejects ${name}`, async () => {
    const { directory, env } = await fixture();
    await writeFile(join(directory, 'ABCDEF1234567890ABCDEF1234567890-42-mrp.json'), content);
    const result = await run(directory, env);
    assert.notEqual(result.code, 0);
    assert.match(result.output, expected);
    assert.deepEqual(await readdir(directory), ['ABCDEF1234567890ABCDEF1234567890-42-mrp.json']);
  });
}

for (const [name, template, expected] of [
  ['absent placeholder', 'https://example.com/quote', /must contain/],
  ['unsupported protocol', 'file:///quote/{artemisQuotGuid}', /must use http/],
  ['malformed URL', 'invalid/{artemisQuotGuid}', /Invalid URL/]
]) {
  test(`quote-page rejects ${name} in a template`, async () => {
    const { directory, env } = await fixture();
    env.QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE = template;
    const result = await run(directory, env);
    assert.notEqual(result.code, 0);
    assert.match(result.output, expected);
    assert.deepEqual(await readdir(directory), ['ABCDEF1234567890ABCDEF1234567890-42-mrp.json']);
  });
}

test('quote-page help works without configuration', async () => {
  const { directory, env } = await fixture();
  for (const name of settings) {
    delete env[name];
  }

  const result = await run(directory, env, ['--help']);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Usage:/);
});

test('quote-page stops after an HTTP failure and respects environment over .env', async () => {
  const { directory, env } = await fixture();
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(503);
    response.end('Unavailable');
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    env.QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE = `${base}/nhi/{artemisQuotGuid}`;
    env.QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE = `${base}/tcas/{policyDetailsId}/{historyId}`;
    await writeFile(join(directory, '.env'), 'QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE=invalid');
    const result = await run(directory, env);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /HTTP 503/);
    assert.ok(requests.includes('/nhi/guid'));
    assert.ok(requests.every((path) => !path.startsWith('/tcas/')));
    assert.deepEqual((await readdir(directory)).sort(), ['.env', 'ABCDEF1234567890ABCDEF1234567890-42-mrp.json']);
    assert.equal(await readFile(join(directory, '.env'), 'utf8'), 'QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE=invalid');
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
  }
});
