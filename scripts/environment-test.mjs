import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadEnvironment } from '../dist/environment.js';

async function load(content, environment = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'environment-test-'));
  const path = join(directory, '.env');
  await writeFile(path, content);
  return loadEnvironment(path, environment);
}

test('environment resolves quoted, nested and forward references from .env', async () => {
  const values = await load(
    'MRP_AND_QUOTE_OUTPUT_DIR="${OUTPUT_ROOT}/output"\nOUTPUT_ROOT=${REPO_BASE_PATH}/GoPackages/internal/mrp-and-quote\nREPO_BASE_PATH="D:/repo with spaces"'
  );
  assert.equal(values.MRP_AND_QUOTE_OUTPUT_DIR, 'D:/repo with spaces/GoPackages/internal/mrp-and-quote/output');
  assert.equal(values.OUTPUT_ROOT, 'D:/repo with spaces/GoPackages/internal/mrp-and-quote');
});

test('environment uses externally configured values over file values without mutating the input', async () => {
  const environment = { ROOT: 'D:/external', OUTPUT: '${ROOT}/override', UNRELATED: '${MISSING}' };
  const values = await load('ROOT=D:/file\nOUTPUT=${ROOT}/file', environment);
  assert.equal(values.OUTPUT, 'D:/external/override');
  assert.equal(values.UNRELATED, '${MISSING}');
  assert.equal(environment.OUTPUT, '${ROOT}/override');
});

test('environment supports references defined only in the process environment', async () => {
  const values = await load('OUTPUT=${REPO_BASE_PATH}/output', { REPO_BASE_PATH: 'D:/repositories' });
  assert.equal(values.OUTPUT, 'D:/repositories/output');
});

test('environment preserves empty values, repeated references and quote-page URL placeholders', async () => {
  const values = await load(
    'EMPTY=\nROOT=https://example.com\nURL=${ROOT}/{policyDetailsId}/${EMPTY}/{historyId}?again=${ROOT}'
  );
  assert.equal(values.URL, 'https://example.com/{policyDetailsId}//{historyId}?again=https://example.com');
});

test('environment rejects a missing reference with its variable name', async () => {
  await assert.rejects(load('OUTPUT=${REPO_BASE_PATH}/output'), /REPO_BASE_PATH is referenced but not defined/);
});

test('environment rejects direct and indirect reference cycles', async () => {
  await assert.rejects(load('A=${A}'), /Circular environment variable reference: A -> A/);
  await assert.rejects(load('A=${B}\nB=${C}\nC=${A}'), /A -> B -> C -> A/);
});

test('environment overrides can break file cycles and undefined overrides do not hide file values', async () => {
  const values = await load('A=${B}\nB=${A}\nROOT=file\nOUTPUT=${ROOT}', { B: 'external', ROOT: undefined });
  assert.equal(values.A, 'external');
  assert.equal(values.OUTPUT, 'file');
});

test('environment allows a missing .env file when settings are provided externally', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'environment-missing-'));
  const values = await loadEnvironment(join(directory, '.env'), { OUTPUT: 'external' });
  assert.deepEqual(values, { OUTPUT: 'external' });
});
