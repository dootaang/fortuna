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

  // Every timeframe keeps updating as ticks arrive (a chart update error used to crash the page).
  for (const frame of ["1분", "5분", "15분", "1시간", "1분"]) {
    await page.getByRole("tab", { name: frame, exact: true }).click();
    await page.waitForTimeout(2_500);
    await expect(page.getByRole("heading", { name: "포르투나 코인" })).toBeVisible();
  }

  // Spot: buy 100 coins' worth, then sell it all.
  await expect(page.getByRole("tab", { name: "현물 · 사고팔기" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("살 금액 (코인)").fill("100");
  await page.getByRole("button", { name: "포르투나 코인 사기" }).click();
  await expect(page.getByText(/FTN [\d.]+개를 샀습니다/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("평균 매입가")).toBeVisible();
  await page.screenshot({ path: "test-results/shots/35-market-spot.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "팔기", exact: true }).click();
  await page.getByRole("button", { name: "포르투나 코인 팔기" }).click();
  await expect(page.getByText(/FTN [\d.]+개를 팔았습니다/)).toBeVisible({ timeout: 15_000 });

  // Futures.
  await page.getByRole("tab", { name: "선물 · 레버리지" }).click();
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
  await expect(page.getByText("현물 매수").first()).toBeVisible();
  await expect(page.getByText("현물 매도").first()).toBeVisible();
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
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "중원", exact: true }).click();
  await expect(page.getByText("중원 간부전을 예고했습니다.")).toBeVisible();
  await expect(page.getByText(/간부전 대기 \(새 진입·매수 정지\)/)).toBeVisible();
  await expect(page.getByText("중원 간부전이 예고되었다. 거리의 말소리가 낮아진다.")).toBeVisible();
  await page.screenshot({ path: "test-results/shots/34-dealer-market.png", fullPage: true, animations: "disabled" });
});
