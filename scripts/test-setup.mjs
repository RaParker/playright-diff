// Loaded with --import before every test file (see package.json). Many tests check the colours of log lines, and the
// CLI they spawn inherits this environment, so colours are switched back on even when the caller's terminal sets
// NO_COLOR.
delete process.env.NO_COLOR;
// The CLI reads these from the project's .env, which the environment overrides, so tests get the defaults whatever .env
// sets; tests that expect other values set them themselves.
process.env.SCREENSHOT_SCALE = '1';
process.env.COMPARE_BEFORE_NAME = 'before';
process.env.COMPARE_AFTER_NAME = 'after';

// Tests that call the modules directly run from the project folder, where output is refused, so their default output
// (such as the OCR cache) goes to a temporary folder instead. It is kept between runs so the OCR language data is
// downloaded only once. CLIs that tests spawn are unaffected: they set their own output folder or working directory.
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { setOutputRoot } = await import('../dist/output-paths.js');
setOutputRoot(join(tmpdir(), 'playwright-diff-test-output'));
