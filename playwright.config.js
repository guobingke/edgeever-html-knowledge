import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const browserRoot = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const installed = existsSync(browserRoot) ? readdirSync(browserRoot)
  .filter(name => name.startsWith('chromium_headless_shell-')).sort().reverse()
  .map(name => path.join(browserRoot, name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'))
  .find(candidate => existsSync(candidate)) : undefined;

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173', browserName: 'chromium',
    launchOptions: installed ? { executablePath: installed } : {},
    screenshot: 'only-on-failure', trace: 'retain-on-failure', acceptDownloads: true,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: {
    command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4173/demo/',
    timeout: 10_000, reuseExistingServer: !process.env.CI,
  },
});
