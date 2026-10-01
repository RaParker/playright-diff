# Required verification before task completion

**Before marking any task as completed, `VerifyProject.ps1` must have completed successfully.**

Run `./VerifyProject.ps1` from the repository root after the final changes. If it
fails, resolve the failures and rerun it successfully before reporting completion.
If verification cannot run, report the blocker and leave the task incomplete.

# Function ordering

Place exported functions above non-exported functions. Put the file's most
important function first among its functions; when a function matches the file's
name (for example, `compare` in `compare.ts`), it must be the top-most function.
Keep supporting helper functions below the public entry points.

# Boolean naming

Use positive boolean names in code, such as `useOcr`, rather than negated names
such as `noOcr`. Translate negative CLI flags such as `--no-ocr` into positive
options at the CLI boundary.

# Line endings

Use LF line endings for all text files, including configuration files and scripts.
