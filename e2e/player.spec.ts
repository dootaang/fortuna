import { expect, test, type Page } from "@playwright/test";
import { resetEmulators, seedCity, type SeededCity } from "./seed.ts";

let city: SeededCity;

test.beforeAll(async () => { await resetEmulators(); city = await seedCity(); });

async function enterCity(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("FRT-XXXX-XXXX-XXXX").fill(city.code.toLowerCase());
  await page.getByRole("button", { name: "개찰구 통과" }).click();
}

test("arrival, work, gamble, shop and wallet on a phone", async ({ page }) => {
  await enterCity(page);
  await expect(page.getByText("지배인의 편지")).toBeVisible();
  await page.screenshot({ path: "test-results/shots/01-letter.png", animations: "disabled" });
  await page.getByRole("button", { name: "봉투를 받는다" }).click();
  await page.getByRole("button", { name: "환영 봉투 열기" }).click();
  await expect(page.getByText("차용증", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/shots/02-envelope.png", animations: "disabled" });
  await page.getByRole("button", { name: "도시로 들어선다" }).click();

  // Lobby: 1,000 envelope − 100 gate fee, debt 1,500.
  await expect(page.getByRole("heading", { name: "에이든", level: 1 })).toBeVisible();
  await expect(page.locator("header").getByText("900")).toBeVisible();
  await page.screenshot({ path: "test-results/shots/03-lobby.png", fullPage: true, animations: "disabled" });

  // Work: the timing shift is the quickest to drive.
  await page.getByRole("link", { name: /일터/ }).first().click();
  await page.getByRole("link", { name: /약탕 불 조절/ }).click();
  await page.getByRole("button", { name: /근무 시작/ }).click();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.getByRole("button", { name: /불 조절/ }).dispatchEvent("pointerdown");
    await page.waitForTimeout(720);
  }
  await expect(page.getByText("임금 명세서")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("지배인 몫 (50%)")).toBeVisible();
  await page.screenshot({ path: "test-results/shots/04-wage-slip.png", animations: "disabled" });

  // Alley odd-even.
  await page.goto("/alley");
  await page.getByRole("link", { name: /홀짝/ }).click();
  await page.getByRole("button", { name: "판을 연다" }).click();
  await page.getByRole("button", { name: "홀", exact: true }).click();
  await expect(page.getByRole("button", { name: "한 판 더" })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "test-results/shots/05-odd-even.png", animations: "disabled" });

  // House blackjack: stand until the hand ends.
  await page.goto("/table/house/blackjack");
  await page.getByRole("button", { name: "판을 연다" }).click();
  const stand = page.getByRole("button", { name: /스탠드/ });
  const again = page.getByRole("button", { name: "한 판 더" });
  await expect(stand.or(again)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "test-results/shots/06-blackjack.png", animations: "disabled" });
  if (await stand.isVisible()) await stand.click();
  await expect(again).toBeVisible({ timeout: 15_000 });

  // Last train: ride one station and get off if the conductor allows.
  await page.goto("/table/alley/last-train");
  await page.getByRole("button", { name: "판을 연다" }).click();
  await page.getByRole("button", { name: /한 정거장 더/ }).click();
  const getOff = page.getByRole("button", { name: "내린다" });
  await expect(async () => { if (!(await again.isVisible())) await expect(getOff).toBeEnabled({ timeout: 500 }); }).toPass({ timeout: 15_000 });
  if (!(await again.isVisible())) await getOff.click();
  await expect(again).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "test-results/shots/07-last-train.png", animations: "disabled" });

  // Shop: buy the rumour and read its secret.
  await page.goto("/shop");
  await expect(page.getByText("무협 간부의 버릇")).toBeVisible();
  await page.screenshot({ path: "test-results/shots/08-shop.png", fullPage: true, animations: "disabled" });
  await page.locator("article", { hasText: "무협 간부의 버릇" }).getByRole("button", { name: /구매/ }).click();
  await page.getByRole("button", { name: /비밀 내용 보기/ }).click();
  await expect(page.getByText("검을 뽑기 전에 왼손으로 소매를 턴다.")).toBeVisible();
  await page.getByRole("button", { name: "닫기" }).click();

  // Wallet: pay a boosted skill (4→5 = 300 + 1,000) by borrowing the shortfall if needed.
  await page.goto("/wallet");
  await page.getByRole("radio", { name: /쾌검/ }).click();
  await page.getByRole("button", { name: "5점", exact: true }).click();
  await expect(page.getByText("1,300").first()).toBeVisible();
  await page.getByRole("button", { name: /결제 · 1,300/ }).click();
  await expect(page.getByText("특기 결제").first()).toBeVisible();
  await expect(page.getByText(/쾌검 4→5점/)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "test-results/shots/09-wallet.png", fullPage: true, animations: "disabled" });
});

test("a second device joins with the same code", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await enterCity(page);
  await expect(page.getByRole("heading", { name: "에이든", level: 1 })).toBeVisible();
  await context.close();
});

test("a wrong code is politely refused", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByPlaceholder("FRT-XXXX-XXXX-XXXX").fill("FRT-0000-0000-0000");
  await page.getByRole("button", { name: "개찰구 통과" }).click();
  await expect(page.getByText(/등록되지 않은 접속 코드/)).toBeVisible();
  await context.close();
});
