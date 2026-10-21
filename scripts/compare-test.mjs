import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { compare } from '../dist/compare.js';

async function run(args) {
  const child = spawn(process.execPath, [resolve('dist/main.js'), 'compare', ...args]);
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
  // arrange
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

    // act
    let result = await run([before, before, '--output', same]);

    // assert
    assert.equal(result.code, 0, result.output);
    let report = JSON.parse(await readFile(join(same, 'report.json'), 'utf8'));
    assert.equal(report.changedPixels, 0);
    assert.deepEqual(report.regions, []);
    // Identical images are summarised in green.
    assert.ok(result.output.includes('\u001b[32m0 changed pixels'), result.output);

    // arrange
    const output = join(dir, 'text');

    // act
    result = await run([before, after, '--output', output]);

    // assert
    assert.equal(result.code, 0, result.output);
    report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    assert.ok(report.changedPixels > 0);
    // Differences are summarised in yellow.
    assert.ok(result.output.includes(`\u001b[33m${report.changedPixels} changed pixels`), result.output);
    assert.ok(report.regions.some((r) => r.textChanges.some((c) => c.type === 'removed' && c.text.includes('100'))));
    assert.ok(report.regions.some((r) => r.textChanges.some((c) => c.type === 'added' && c.text.includes('200'))));
    assert.ok((await sharp(join(output, 'diff.png')).metadata()).width === 700);
    // Tesseract's own diagnostics are not echoed for each crop.
    assert.doesNotMatch(result.output, /Estimating resolution|Invalid resolution/, result.output);
    assert.ok(result.output.includes('Region 1: Recognized text differs'), result.output);
    assert.ok(result.output.includes('1 changed region, 1 with text changes.'), result.output);

    // arrange
    const taller = join(dir, 'taller.png');
    await sharp(before).extend({ bottom: 50, background: 'white' }).png().toFile(taller);
    const dimensions = join(dir, 'dimensions');

    // act
    result = await run([before, taller, '--no-ocr', '--output', dimensions]);

    // assert
    assert.equal(result.code, 0, result.output);
    report = JSON.parse(await readFile(join(dimensions, 'report.json'), 'utf8'));
    assert.equal(report.changedPixels, 700 * 50);
    assert.equal(report.ocrEnabled, false);

    // arrange
    const directOutput = join(dir, 'direct-dimensions');

    // act
    await compare(before, taller, { useOcr: false, output: directOutput });

    // assert
    const directReport = JSON.parse(await readFile(join(directOutput, 'report.json'), 'utf8'));
    assert.deepEqual(directReport, report);
    assert.equal(
      await readFile(join(directOutput, 'report.md'), 'utf8'),
      await readFile(join(dimensions, 'report.md'), 'utf8')
    );

    // act
    const existingOutput = await run([before, after, '--output', same]);
    const negativeThreshold = await run([before, after, '--threshold', '-1']);
    const missingImage = await run([before, join(dir, 'missing.png')]);

    // assert
    assert.notEqual(existingOutput.code, 0, 'Must refuse an existing output directory');
    assert.notEqual(negativeThreshold.code, 0);
    assert.notEqual(missingImage.code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('comparison lists only regions whose recognised text changed', { timeout: 180000 }, async () => {
  // arrange
  const dir = await mkdtemp(join(tmpdir(), 'image-compare-test-'));
  try {
    const before = join(dir, 'before.png'),
      after = join(dir, 'after.png');
    for (const [path, fill] of [
      [before, 'black'],
      [after, '#666']
    ]) {
      await sharp(
        Buffer.from(
          `<svg width="700" height="160"><rect width="700" height="160" fill="white"/><text x="30" y="100" font-size="48" font-family="Arial" fill="${fill}">Price 100 dollars</text></svg>`
        )
      )
        .png()
        .toFile(path);
    }

    // act
    const result = await run([before, after, '--output', join(dir, 'colour')]);

    // assert
    assert.equal(result.code, 0, result.output);
    const report = JSON.parse(await readFile(join(dir, 'colour', 'report.json'), 'utf8'));
    assert.equal(report.regions.length, 1);
    assert.equal(report.regions[0].assessment, 'Recognized text unchanged; visual appearance differs');
    assert.doesNotMatch(result.output, /Region 1:/, result.output);
    assert.ok(result.output.includes('1 changed region, 0 with text changes.'), result.output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reuseOutput writes the report into an existing folder beside the images', async () => {
  // arrange
  const dir = await mkdtemp(join(tmpdir(), 'image-compare-reuse-'));
  try {
    const [before, after] = [join(dir, 'nhi.png'), join(dir, 'tcas.png')];
    for (const path of [before, after]) {
      await sharp({ create: { width: 40, height: 20, channels: 3, background: '#fff' } })
        .png()
        .toFile(path);
    }

    // act
    await compare(before, after, { output: dir, reuseOutput: true, useOcr: false });

    // assert
    const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
    assert.equal(report.changedPixels, 0);
    assert.equal(report.before, before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const [name, after, expected] of [
  [
    'prints identicalMessage in yellow instead of the green count when the images match',
    '#fff',
    '\u001b[33mBoth referred. Report: '
  ],
  [
    'prints the yellow changed-pixel count, not identicalMessage, when the images differ',
    '#000',
    '\u001b[33m800 changed pixels'
  ]
]) {
  test(name, async (context) => {
    // arrange
    const dir = await mkdtemp(join(tmpdir(), 'image-compare-message-'));
    context.after(() => rm(dir, { recursive: true, force: true }));
    const paths = [join(dir, 'nhi.png'), join(dir, 'tcas.png')];
    for (const [path, background] of [
      [paths[0], '#fff'],
      [paths[1], after]
    ]) {
      await sharp({ create: { width: 40, height: 20, channels: 3, background } })
        .png()
        .toFile(path);
    }
    const log = context.mock.method(console, 'log', () => undefined);

    // act
    await compare(paths[0], paths[1], {
      output: dir,
      reuseOutput: true,
      useOcr: false,
      identicalMessage: 'Both referred.'
    });

    // assert
    const lines = log.mock.calls.map((call) => String(call.arguments[0]));
    assert.ok(
      lines.some((line) => line.startsWith(expected)),
      lines.join('\n')
    );
    assert.equal(
      lines.some((line) => line.includes('Both referred.')),
      after === '#fff'
    );
  });
}
