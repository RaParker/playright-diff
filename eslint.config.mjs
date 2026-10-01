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
  {
    extends: compat.extends('eslint:recommended', 'plugin:prettier/recommended'),
    plugins: { prettier },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jasmine,
        ...globals.jest,
        ...globals.node
      }
    }
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'server/**/*.ts', 'setup/**/*.ts'],
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
      globals: {
        ...globals.browser,
        ...globals.jasmine,
        ...globals.jest
      },
      parser: tsParser
    },
    rules: {
      curly: 'error',
      'prettier/prettier': [
        'error',
        {
          singleQuote: true,
          endOfLine: 'auto'
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
