import { test as base, expect, type Page, type Response } from "@playwright/test";

export const accounts = {
  admin: { email: "admin@tir.local", role: "Admin" },
  user: { email: "user@tir.local", role: "User" },
} as const;

export type Account = keyof typeof accounts;
export type Credentials = { email: string; password: string };

export function credentials(account: Account): Credentials {
  const password = process.env.INIT_PASSWORD;
  if (!password) {
    throw new Error("INIT_PASSWORD is not set. It is the password of the seeded accounts.");
  }
  return { email: accounts[account].email, password };
}

export async function waitForHydration(page: Page) {
  await page.waitForFunction(() =>
    Boolean((document.querySelector("#__nuxt") as any)?.__vue_app__),
  );
}

export async function acceptLoginBanner(page: Page) {
  const modalConfirm = page.getByRole("dialog").getByRole("button", { name: /accept|agree|ok/i });
  if (await modalConfirm.isVisible().catch(() => false)) await modalConfirm.click();

  const consent = page.locator("#consent-checkbox");
  if (await consent.isVisible().catch(() => false)) await consent.check();
}

export async function submitLogin(page: Page, { email, password }: Credentials) {
  await page.goto("/");
  await waitForHydration(page);
  await acceptLoginBanner(page);
  await page.locator('input[name="text"]').fill(email);
  const passwordField = page.locator('input[name="password"]');
  await passwordField.fill(password);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/auth/login/") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  await passwordField.fill("");
  return loginResponse;
}

export async function expectLoginAccepted(response: Response, email: string) {
  const body = await response.text();
  expect(response.status(), `login API answered ${response.status()} for ${email}: ${body}`).toBe(
    200,
  );
  expect(JSON.parse(body).success, `login API rejected ${email}: ${body}`).toBe(true);
}

export async function login(page: Page, account: Account) {
  const creds = credentials(account);
  const response = await submitLogin(page, creds);
  await expectLoginAccepted(response, creds.email);
  await page.waitForURL("**/home");
}

export const test = base.extend<{ adminPage: Page; userPage: Page }>({
  adminPage: async ({ page }, use) => {
    await login(page, "admin");
    await use(page);
  },
  userPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, "user");
    await use(page);
    await context.close();
  },
});

export { expect };
