import { defineConfig } from 'eslint/config';
import prettier from 'eslint-plugin-prettier';
import globals from 'globals';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default defineConfig([
  { ignores: ['dist/**', 'screenshots/**', 'comparisons/**'] },
  {
    extends: compat.extends('eslint:recommended', 'plugin:prettier/recommended'),
    plugins: { prettier },
    languageOptions: {
      // Node for the scripts themselves; browser for the code they run in pages. Tests use node:test, not Jest.
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: ['src/**/*.ts'],
    extends: compat.extends(
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:prettier/recommended'
    ),
    plugins: {
      '@typescript-eslint': typescriptEslint,
      prettier
    },
    languageOptions: {
      // Browser for the functions run in pages (page.evaluate); Node's types come from the TypeScript project.
      globals: {
        ...globals.browser
      },
      parser: tsParser,
      parserOptions: { projectService: true, tsconfigRootDir: __dirname }
    },
    rules: {
      curly: 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false
        }
      ],
      'prettier/prettier': [
        'error',
        {
          singleQuote: true,
          endOfLine: 'lf'
        }
      ],
      'padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: 'block-like',
          next: '*'
        }
      ],
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/no-use-before-define': [
        'error',
        {
          functions: false,
          typedefs: false
        }
      ]
    }
  }
]);
