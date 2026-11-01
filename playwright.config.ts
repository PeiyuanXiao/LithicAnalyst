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
  // SwiftShader spreads each browser over all the cores, so more workers only compete: on 16 threads
  // 2 workers take 148 s (slowest test 14 s), 3 take 133 s (19 s), 4 take 144 s (30 s), and the default 8 take
  // 270 s with tests running out of their 60 s. CI runners have 4 threads: as many per thread as those 8.
  workers: process.env.CI ? 1 : 2,
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
