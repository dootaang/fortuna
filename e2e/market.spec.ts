import { expect, test } from "@playwright/test";
import { allowDealer, playSomeGames, resetEmulators, seedCity, startRecorder, type SeededCity } from "./seed.ts";

let city: SeededCity;
let recorder: Awaited<ReturnType<typeof startRecorder>>;

test.beforeAll(async () => {
  await resetEmulators();
  city = await seedCity();
  await playSomeGames(city.code, 0);
  recorder = await startRecorder();
});
test.afterAll(async () => { await recorder?.stop(); });

test("exchange: board, chart, leveraged long with the loan slip, close", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByPlaceholder("FRT-XXXX-XXXX-XXXX").fill(city.code);
  await page.getByRole("button", { name: "개찰구 통과" }).click();

  // Lobby card quotes FTN.
  const card = page.getByRole("link", { name: /환전가 거래소/ });
  await expect(card).toContainText(/FTN [\d,]+\.\d\d/, { timeout: 15_000 });
  await card.click();

  // The departure board lists all nine coins and keeps ticking.
  await expect(page.getByRole("heading", { name: "환전가 거래소" })).toBeVisible();
  await expect(page.getByRole("link", { name: /포르투나 코인/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /무월 코인/ })).toBeVisible();
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: "test-results/shots/30-market-board.png", fullPage: true, animations: "disabled" });

  await page.getByRole("link", { name: /포르투나 코인/ }).click();
  await expect(page.getByRole("heading", { name: "포르투나 코인" })).toBeVisible();
  await expect(page.getByRole("img", { name: /FTN 가격 차트/ })).toBeVisible();

  await page.getByLabel("증거금 (코인)").fill("100");
  await page.getByRole("button", { name: "5배", exact: true }).click();
  await page.screenshot({ path: "test-results/shots/31-market-coin.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: /롱 진입 · 5배/ }).click();

  const slip = page.getByRole("dialog", { name: "지배인 대출 약정서" });
  await expect(slip).toContainText("빌리는 돈 400코인");
  await page.screenshot({ path: "test-results/shots/32-market-slip.png", animations: "disabled" });
  await slip.getByRole("button", { name: "서명하고 진입" }).click();
  await expect(slip).toHaveCount(0, { timeout: 10_000 });

  const position = page.locator("article", { hasText: "롱 ▲ 5배" });
  await expect(position).toBeVisible();
  await page.waitForTimeout(2_000);
  await page.screenshot({ path: "test-results/shots/33-market-position.png", fullPage: true, animations: "disabled" });

  await position.getByRole("button", { name: "청산" }).click();
  await expect(page.getByText(/FTN 정산: [\d,]+코인/)).toBeVisible({ timeout: 15_000 });
  await expect(position).toHaveCount(0);

  // The wallet history shows both legs.
  await page.goto("/wallet");
  await expect(page.getByText("거래소 진입").first()).toBeVisible();
  await expect(page.getByText("거래소 정산").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("dealer: exchange tab shows the recorder, positions and news desk", async ({ page }) => {
  await page.goto("/dealer");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Google로 로그인" }).click();
  const popup = await popupPromise;
  await popup.getByText("Add new account").click();
  await popup.locator("#email-input").fill("gm-market@example.com");
  await popup.getByRole("button", { name: /Sign in with Google/ }).click();
  const uid = (await page.locator("code").filter({ hasText: /^[A-Za-z0-9]{20,}$/ }).first().textContent())?.trim() ?? "";
  await allowDealer(uid);
  await page.getByRole("button", { name: "거래소", exact: true }).click();
  await expect(page.getByText(/· 정상/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "중원" }).click();
  await expect(page.getByLabel("소식 문구 (구역의 목소리로 한 줄)")).toHaveValue(/중원 간부전이 예고되었다/);
  await page.getByRole("button", { name: "발행 예약" }).click();
  await expect(page.getByText("예약했습니다.")).toBeVisible();
  await page.screenshot({ path: "test-results/shots/34-dealer-market.png", fullPage: true, animations: "disabled" });
});
