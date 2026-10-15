import { expect, test } from "@playwright/test";
import { allowDealer, playSomeGames, resetEmulators, seedCity, signInWithGooglePopup } from "./seed.ts";

test("dealer: sign in, get allow-listed, register a player, audit and liberate", async ({ page }) => {
  await resetEmulators();
  const city = await seedCity();
  await playSomeGames(city.code);

  await page.goto("/dealer");
  await signInWithGooglePopup(page, "gm@example.com");

  // Not yet allow-listed: the page shows the uid to paste into the console.
  await expect(page.getByRole("heading", { name: "딜러 등록이 필요합니다" })).toBeVisible();
  await page.screenshot({ path: "test-results/shots/10-dealer-onboarding.png", animations: "disabled" });
  const uid = (await page.locator("code").filter({ hasText: /^[A-Za-z0-9]{20,}$/ }).first().textContent())?.trim() ?? "";
  await allowDealer(uid);
  await expect(page.getByText("딜러 화면", { exact: true })).toBeVisible();

  // Overview lists the seeded player with their wallet.
  await expect(page.getByRole("cell", { name: "에이든" })).toBeVisible();
  await page.screenshot({ path: "test-results/shots/11-dealer-overview.png", fullPage: true, animations: "disabled" });

  // Register a new passenger and receive a code.
  await page.getByRole("button", { name: "플레이어", exact: true }).click();
  await page.getByRole("button", { name: "+ 플레이어 등록" }).click();
  await page.getByLabel("캐릭터 이름").fill("벨라");
  await page.locator("select").first().selectOption("romance");
  await page.getByPlaceholder("특기 이름").fill("매혹");
  await page.getByRole("button", { name: "등록하고 접속 코드 발급" }).click();
  await expect(page.getByRole("dialog", { name: /벨라의 접속 코드/ })).toContainText(/FRT-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
  await page.getByRole("button", { name: "닫기" }).click();

  // Ledger: every seeded settlement replays to the recorded payout.
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await page.getByRole("button", { name: "모두 재생 검증" }).click();
  await expect(page.getByText(/모두 재생 결과와 일치합니다/)).toBeVisible();
  await page.screenshot({ path: "test-results/shots/12-dealer-ledger.png", fullPage: true, animations: "disabled" });

  // Liberate the wuxia district.
  await page.getByRole("button", { name: "구역", exact: true }).click();
  const wuxia = page.locator(".deco-frame", { hasText: "천마 (무협)" });
  await wuxia.getByText("해방됨").click();
  await wuxia.getByRole("button", { name: "저장" }).click();
  await expect(wuxia.getByText("해방", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByRole("heading", { name: "경제 설정" })).toBeVisible();
  await page.screenshot({ path: "test-results/shots/13-dealer-settings.png", fullPage: true, animations: "disabled" });
});
