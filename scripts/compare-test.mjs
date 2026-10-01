import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

async function run(args) {
  const child = spawn(process.execPath, [resolve('dist/compare.js'), ...args]);
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const code = await new Promise((ok, fail) => {
    child.once('error', fail);
    child.once('close', ok);
  });
  return { code, output };
}

test('comparison detects pixel, dimension, and OCR changes', { timeout: 180000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'image-compare-test-'));
  try {
    const before = join(dir, 'before.png'),
      after = join(dir, 'after.png');
    for (const [path, text] of [
      [before, 'Price 100 dollars'],
      [after, 'Price 200 dollars']
    ]) {
      await sharp(
        Buffer.from(
          `<svg width="700" height="160"><rect width="700" height="160" fill="white"/><text x="30" y="100" font-size="48" font-family="Arial">${text}</text></svg>`
        )
      )
        .png()
        .toFile(path);
    }
    const same = join(dir, 'same');
    let result = await run([before, before, '--output', same]);
    assert.equal(result.code, 0, result.output);
    let report = JSON.parse(await readFile(join(same, 'report.json'), 'utf8'));
    assert.equal(report.changedPixels, 0);
    assert.deepEqual(report.regions, []);

    const output = join(dir, 'text');
    result = await run([before, after, '--output', output]);
    assert.equal(result.code, 0, result.output);
    report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    assert.ok(report.changedPixels > 0);
    assert.ok(report.regions.some((r) => r.textChanges.some((c) => c.type === 'removed' && c.text.includes('100'))));
    assert.ok(report.regions.some((r) => r.textChanges.some((c) => c.type === 'added' && c.text.includes('200'))));
    assert.ok((await sharp(join(output, 'diff.png')).metadata()).width === 700);

    const taller = join(dir, 'taller.png');
    await sharp(before).extend({ bottom: 50, background: 'white' }).png().toFile(taller);
    const dimensions = join(dir, 'dimensions');
    result = await run([before, taller, '--no-ocr', '--output', dimensions]);
    assert.equal(result.code, 0, result.output);
    report = JSON.parse(await readFile(join(dimensions, 'report.json'), 'utf8'));
    assert.equal(report.changedPixels, 700 * 50);
    assert.equal(report.ocrEnabled, false);

    result = await run([before, after, '--output', same]);
    assert.notEqual(result.code, 0, 'Must refuse an existing output directory');
    result = await run([before, after, '--threshold', '-1']);
    assert.notEqual(result.code, 0);
    result = await run([before, join(dir, 'missing.png')]);
    assert.notEqual(result.code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
