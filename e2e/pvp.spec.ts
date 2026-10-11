import { expect, test, type Browser, type Page } from "@playwright/test";
import { resetEmulators, seedCity, seedPlayers } from "./seed.ts";

async function arrive(browser: Browser, code: string, name: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByPlaceholder("FRT-XXXX-XXXX-XXXX").fill(code);
  await page.getByRole("button", { name: "개찰구 통과" }).click();
  await page.getByRole("button", { name: "봉투를 받는다" }).click();
  await page.getByRole("button", { name: "환영 봉투 열기" }).click();
  await page.getByRole("button", { name: "도시로 들어선다" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page;
}

test("three passengers play pvp old maid to the end; winner takes all", async ({ browser }) => {
  test.setTimeout(300_000);
  await resetEmulators();
  const city = await seedCity();
  const [codeB, codeC] = await seedPlayers(["벨라", "카이"]);
  const errors: string[] = [];
  const pages = [await arrive(browser, city.code, "에이든"), await arrive(browser, codeB!, "벨라"), await arrive(browser, codeC!, "카이")];
  pages.forEach((page) => page.on("pageerror", (error) => errors.push(error.message)));
  const [a, b, c] = pages as [Page, Page, Page];

  // A opens a 3-seat room in the alley.
  await a.goto("/alley");
  await a.getByRole("button", { name: "방 만들기" }).click();
  await a.getByRole("button", { name: "3명" }).click();
  await a.getByRole("button", { name: "판 열기" }).click();
  await expect(a).toHaveURL(/\/pvp\//);
  const roomUrl = a.url();

  // B and C find it in the lobby and sit down.
  for (const page of [b, c]) {
    await page.goto("/alley");
    await page.getByText("에이든의 판").click();
    await page.getByRole("button", { name: /걸고 앉기/ }).click();
    await expect(page.getByRole("button", { name: /나가기/ })).toBeVisible();
  }
  await expect(a.getByRole("button", { name: "3명으로 시작" })).toBeVisible();
  await a.screenshot({ path: "test-results/pvp/01-waiting.png" });
  await a.getByRole("button", { name: "3명으로 시작" }).click();

  // Play: whoever is being drawn from offers, whoever draws clicks the first card.
  const deadline = Date.now() + 240_000;
  let turns = 0;
  while (Date.now() < deadline) {
    if (await a.getByText("WINNER TAKES ALL").isVisible().catch(() => false)) break;
    for (const page of pages) {
      const offer = page.getByRole("button", { name: "이대로 내밀기" });
      if (await offer.isVisible().catch(() => false) && await offer.isEnabled().catch(() => false)) await offer.click({ timeout: 1_000 }).catch(() => undefined);
      const card = page.locator(".om-offer-card:not([disabled])").first();
      if (await card.isVisible().catch(() => false)) { await card.click({ timeout: 1_000 }).catch(() => undefined); turns += 1; }
    }
    if (turns === 2) await a.screenshot({ path: "test-results/pvp/02-playing.png" });
    await a.waitForTimeout(250);
  }
  for (const page of pages) await expect(page.getByText("WINNER TAKES ALL")).toBeVisible({ timeout: 20_000 });
  await a.screenshot({ path: "test-results/pvp/03-result.png", fullPage: true });

  // Everyone was settled automatically and is free to sit again.
  for (const page of pages) {
    await page.goto("/wallet");
    await expect(page.getByText("대결 정산").first()).toBeVisible({ timeout: 15_000 });
    await page.goto("/alley");
    await expect(page.getByRole("button", { name: "방 만들기" })).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(roomUrl).toContain("/pvp/");
});
