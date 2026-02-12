const { test, expect } = require('@playwright/test');

function randomEmail() {
  const salt = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  return `e2e_${salt}@example.com`;
}

test.describe('E2E: traceId visible on upload failure', () => {
  test('login -> upload -> toast includes traceId', async ({ page, request }) => {
    const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
    const apiBase = process.env.E2E_API_BASE_URL || 'http://localhost:5001/api';

    const email = randomEmail();
    const password = 'Password123'; // satisfies backend password schema

    // Create user and patient through API to keep UI flow focused.
    const registerRes = await request.post(`${apiBase}/auth/register`, {
      data: {
        email,
        password,
        name: 'E2E User',
        acceptComplianceSecurityAgreement: true,
      },
    });
    expect(registerRes.ok()).toBeTruthy();
    const registerBody = await registerRes.json();
    const token = registerBody?.data?.token;
    expect(typeof token).toBe('string');

    const patientRes = await request.post(`${apiBase}/patients`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      data: {
        name: 'E2E Patient',
        gender: 'male',
      },
    });
    expect(patientRes.ok()).toBeTruthy();
    const patientBody = await patientRes.json();
    const patientId = patientBody?.data?.patient?.id;
    expect(typeof patientId).toBe('string');

    // Login via UI (explicit requirement).
    await page.goto(`${baseURL}/auth/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    // Avoid matching the "显示密码" toggle button (it contains the substring "密码").
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录' }).click();

    // App redirects after login; don't overfit the target, just ensure auth succeeded.
    await expect(page.getByText('登录成功')).toBeVisible();

    // Arrange: force OCR upload to fail with a known traceId.
    const forcedTraceId = 'e2e-trace-ocr-001';
    await page.route('**/api/medical/upload', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: {
          'x-request-id': forcedTraceId,
        },
        body: JSON.stringify({
          success: false,
          message: 'OCR处理失败（E2E强制）',
          code: 'e2e_forced_ocr_failure',
          traceId: forcedTraceId,
        }),
      });
    });

    // Go to upload page and trigger upload.
    await page.goto(`${baseURL}/patients/${patientId}/upload`, { waitUntil: 'domcontentloaded' });

    const fileInput = page.locator('#file-input');
    await expect(fileInput).toHaveCount(1);

    await fileInput.setInputFiles({
      name: 'e2e.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello from e2e'),
    });

    // Assert: the error toast shows traceId for online debugging.
    const toast = page
      .locator('div[role="status"][aria-live="polite"]')
      .filter({ hasText: forcedTraceId })
      .first();
    await expect(toast).toBeVisible();
  });
});
