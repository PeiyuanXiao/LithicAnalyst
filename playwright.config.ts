import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive the built single-file app (dist/index.html, opened over file://)
// in Chromium. Without a GPU, WebGL runs on SwiftShader, which is slow: keep test models small.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    // no transitions or fades: the camera is where it was sent at once
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
});
