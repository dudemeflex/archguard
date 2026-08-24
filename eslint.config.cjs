const eslint = require('@eslint/js');
const globals = require('globals');
const typescriptPlugin = require('@typescript-eslint/eslint-plugin');
const typescriptParser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: [
      'action-dist/**',
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'test/cli-tmp*/**'
    ]
  },
  eslint.configs.recommended,
  {
    files: ['src/**/*.{ts,js}', 'test/**/*.{ts,js}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module'
      },
      globals: globals.node
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin
    },
    rules: {
      ...typescriptPlugin.configs.recommended.rules,
      'no-console': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  }
];
