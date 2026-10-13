// Loaded with --import before every test file (see package.json). Many tests check the colours of log lines, and the
// CLI they spawn inherits this environment, so colours are switched back on even when the caller's terminal sets
// NO_COLOR.
delete process.env.NO_COLOR;
