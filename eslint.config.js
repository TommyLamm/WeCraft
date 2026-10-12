import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `public/playroom-sdk.js` is byte-pinned by SHA contract (vendored platform
  // file — must stay byte-identical); excluded narrowly, like dist/node_modules.
  { ignores: ['dist', 'node_modules', '.superpowers', 'public/playroom-sdk.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
