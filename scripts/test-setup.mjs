// Loaded with --import before every test file (see package.json). Many tests check the colours of log lines, and the
// CLI they spawn inherits this environment, so colours are switched back on even when the caller's terminal sets
// NO_COLOR.
delete process.env.NO_COLOR;
// The CLI reads these from the project's .env, which the environment overrides, so tests get the defaults whatever .env
// sets; tests that expect other values set them themselves.
process.env.SCREENSHOT_SCALE = '1';
process.env.COMPARE_BEFORE_NAME = 'before';
process.env.COMPARE_AFTER_NAME = 'after';
