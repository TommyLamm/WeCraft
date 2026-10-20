import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `public/playroom-sdk.js` is byte-pinned by SHA contract (vendored platform
  // file — must stay byte-identical); excluded narrowly, like dist/node_modules.
  // `.worktrees/` 是本 repo 內的 git worktree 根目錄（各批次分支的隔離工作區），
  // 裡面的建置產物不屬於本 checkout 的原始碼，掃到會產生大量無關錯誤。
  { ignores: ['dist', 'node_modules', '.superpowers', '.worktrees', 'public/playroom-sdk.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
