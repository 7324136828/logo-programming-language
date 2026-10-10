import { expect, test } from '@playwright/test';

const backendUrl = 'http://127.0.0.1:8001';

test('serves the health endpoint through FastAPI backend', async ({ request }) => {
  const healthResponse = await request.get(`${backendUrl}/api/health`);
  expect(healthResponse.ok()).toBeTruthy();
  const data = await healthResponse.json();
  expect(data.status).toBe('ok');
  expect(data.service).toContain('TI Logo Studio');

  const samplersResponse = await request.get(`${backendUrl}/api/samplers`);
  expect(samplersResponse.ok()).toBeTruthy();
  const samplers = await samplersResponse.json();
  expect(samplers.length).toBe(10);
});

test('loads the full Logo Studio frontend with playground, editor, and console', async ({ page }) => {
  await page.goto('/');

  // Verify Header & Brand
  await expect(page.locator('.brand-title')).toContainText('logo');
  await expect(page.locator('.brand-title')).toContainText('studio');
  await expect(page.getByText('An old idea. A new playground.')).toBeVisible();

  // Verify Playground Canvas & Coordinates
  await expect(page.locator('#canvas-stage')).toBeVisible();
  await expect(page.locator('#stage-caption')).toContainText('CREATIVE SPACE');
  await expect(page.locator('#turtle-position')).toBeVisible();

  // Verify Editor and Controls
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('#run')).toBeVisible();
  await expect(page.locator('#command')).toBeVisible();

  // Verify 1981 Collection Sidebar
  await expect(page.locator('.library-section .section-label')).toBeVisible();
  await expect(page.getByText('Start exploring')).toBeVisible();
});

test('executes Logo commands from the console and updates canvas status', async ({ page }) => {
  await page.goto('/');

  const commandInput = page.locator('#command');
  await expect(commandInput).toBeVisible();

  // Enter a forward command in the console
  await commandInput.fill('FD 50');
  await page.locator('#send-command').click();

  // Verify command appears in console log
  await expect(page.locator('#console-log')).toContainText('FD 50');
  // Check that turtle position moved along X (heading was 90°)
  await expect(page.locator('#turtle-position')).toContainText('X 50.0');
});

test('navigates to History screen and verifies job management', async ({ page, request }) => {
  // Pre-seed a conversion job via backend API
  const jobRes = await request.post(`${backendUrl}/api/jobs/direct`, {
    data: {
      filename: 'e2e_test_program.logo',
      content: 'TO STAR\n  REPEAT 5 [FD 40 RT 144]\nEND\nCS STAR\n',
    },
  });
  expect(jobRes.ok()).toBeTruthy();

  await page.goto('/');

  // Click on History tab in navigation
  await page.getByRole('button', { name: 'History' }).click();

  // Verify History screen is displayed
  await expect(page.getByRole('heading', { name: 'Conversion & Workspace History' })).toBeVisible();
  await expect(page.locator('.jobs-table')).toBeVisible();
  await expect(page.locator('.jobs-table')).toContainText('e2e_test_program.logo');
});

test('opens and closes the pocket guide modal', async ({ page }) => {
  await page.goto('/');

  // Open guide from header button
  await page.locator('#help').click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A pocket guide to Logo' })).toBeVisible();

  // Close guide
  await page.locator('#help-dialog button[aria-label="Close guide"]').click();
  await expect(page.locator('#help-dialog')).not.toBeVisible();
});
