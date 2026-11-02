import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/gui', workers: 1, retries: 0, timeout: 60000, globalTimeout: 300000,
  use: { actionTimeout: 10000, navigationTimeout: 30000, viewport: { width: 1280, height: 720 }, locale: 'zh-CN', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  outputDir: './test-results', reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
});
