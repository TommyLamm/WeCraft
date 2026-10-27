import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // B7 Task 17：靜態幾何測試讀 `ui.css` 的**真實規則**——jsdom 不算版面，但
    // vitest 注入 <style> 之後可以讀 `document.styleSheets`（repo 只此一份 CSS）。
    css: true,
  },
});
