import { expect, test, type Page } from "@playwright/test";
import { resetEmulators, seedCity } from "./seed.ts";

async function arriveWithFreshPlayer(page: Page) {
  await resetEmulators();
  const city = await seedCity();
  await page.goto("/");
  await page.getByPlaceholder("FRT-XXXX-XXXX-XXXX").fill(city.code);
  await page.getByRole("button", { name: "개찰구 통과" }).click();
  await page.getByRole("button", { name: "봉투를 받는다" }).click();
  await page.getByRole("button", { name: "환영 봉투 열기" }).click();
  await page.getByRole("button", { name: "도시로 들어선다" }).click();
  await expect(page.getByRole("heading", { name: "에이든", level: 1 })).toBeVisible();
}

async function open(page: Page, venue: string, game: string) {
  await page.goto(`/table/${venue}/${game}`);
  await page.getByRole("button", { name: "판을 연다" }).click();
}

const again = (page: Page) => page.getByRole("button", { name: "한 판 더" });

test("the remaining tables and work shifts play to the end", async ({ page }) => {
  test.setTimeout(240_000);
  await arriveWithFreshPlayer(page);

  await open(page, "alley", "roulette");
  await page.getByRole("button", { name: /빨강/ }).click();
  await expect(again(page)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "test-results/shots/20-roulette.png", animations: "disabled" });

  await open(page, "alley", "dice-poker");
  await expect(page.getByRole("button", { name: "딜러의 추천" })).toBeVisible();
  await page.screenshot({ path: "test-results/shots/21-dice-poker.png", animations: "disabled" });
  await page.getByRole("button", { name: /다시 굴리기|이대로 승부/ }).click();
  await expect(again(page)).toBeVisible({ timeout: 15_000 });

  await open(page, "alley", "draw-poker");
  await expect(page.getByRole("button", { name: "딜러의 추천" })).toBeVisible();
  await page.screenshot({ path: "test-results/shots/22-draw-poker.png", animations: "disabled" });
  await page.getByRole("button", { name: /교환|이대로 승부/ }).click();
  await expect(again(page)).toBeVisible({ timeout: 15_000 });

  await open(page, "alley", "old-maid");
  for (let turn = 0; turn < 30 && !(await again(page).isVisible()); turn += 1) {
    const pick = page.getByRole("button", { name: /딜러의 1번째 카드 뽑기/ });
    if (await pick.isEnabled().catch(() => false)) await pick.click();
    await page.waitForTimeout(400);
  }
  await expect(again(page)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "test-results/shots/23-old-maid.png", animations: "disabled" });

  await open(page, "alley", "high-low");
  await page.getByRole("button", { name: /높다/ }).click();
  await expect(page.getByRole("button", { name: /멈추고 받기/ }).or(again(page))).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "test-results/shots/24-high-low.png", animations: "disabled" });

  // Work shifts: sort and math answered at random, memory picked blindly.
  for (const [template, button] of [["sort", /귀중품|식료품|서신/], ["math", /^\d/]] as const) {
    await page.goto(`/work/${template}`);
    await page.getByRole("button", { name: /근무 시작/ }).click();
    await page.screenshot({ path: `test-results/shots/25-work-${template}.png`, animations: "disabled" });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !(await page.getByText("임금 명세서").isVisible())) {
      const choices = page.getByRole("button", { name: button });
      if (await choices.count()) await choices.first().click({ timeout: 1_000 }).catch(() => undefined);
      await page.waitForTimeout(150);
    }
    await expect(page.getByText("임금 명세서")).toBeVisible({ timeout: 15_000 });
  }
  await page.goto("/work/memory");
  await page.getByRole("button", { name: /근무 시작/ }).click();
  await page.screenshot({ path: "test-results/shots/26-work-memory.png", animations: "disabled" });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !(await page.getByText("임금 명세서").isVisible())) {
    const choices = page.locator("main button.btn-dark:not([disabled])");
    if (await choices.count()) await choices.first().click({ timeout: 1_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  await expect(page.getByText("임금 명세서")).toBeVisible({ timeout: 15_000 });
});
