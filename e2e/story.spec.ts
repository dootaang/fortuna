import { expect, test } from "@playwright/test";
import { FRONT_TEXT } from "@fortuna/core";
import { giveClue, importLorePack, openFight, raiseBoss, setBookRevealed, stepFront } from "@fortuna/data";
import { DEFAULT_ECONOMY } from "@fortuna/core";
import { playSomeGames, resetEmulators, seedCity, withDealer, withPlayer, type SeededCity } from "./seed.ts";

let city: SeededCity;

const PACK = JSON.stringify({
  clues: [{ id: "collateral-medieval", district: "medieval", kind: "collateral", title: "봉인된 양피지 사본", public: "앞면의 설명.", secret: "뒷면에 적힌 비밀.", how: "" }],
  pages: { medieval: ["통행세 원장", "등록비 장부", "셋째 쪽 제목", "체납 차용증", "[파국] 봉쇄"], passenger: "승객 [{name}]의 차용증" },
});

test.beforeAll(async () => {
  await resetEmulators();
  city = await seedCity();
  await playSomeGames(city.code, 0);

  await withDealer("dealer@example.com", async (session) => {
    await importLorePack(session, PACK);
    await stepFront(session, "medieval", 1);
    await stepFront(session, "medieval", 1);
    await giveClue(session, "collateral-medieval", [city.pid], "wheel-plaza", ["에이든"], null);
    await setBookRevealed(session, true);
    const id = await openFight(session, "wheel-plaza", { title: "성문 앞 결투", bossName: "마왕", mode: "boss", district: "medieval", rounds: 3, bossVault: 5_000 });
    await raiseBoss(session, id, DEFAULT_ECONOMY.skill.costs, null);
  });
});

test("story (RP on Discord): stake a skill on the fight, clue notebook, fronts board and the revealed ledger", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByPlaceholder("FRT-XXXX-XXXX-XXXX").fill(city.code);
  await page.getByRole("button", { name: "개찰구 통과" }).click();

  // The ✦ button glows ⚔ while a fight is open; its sheet shows the fight, and a payment staked on it becomes this round's party score.
  await page.getByRole("button", { name: "특기 쓰기 (판이 열려 있음)" }).click();
  const sheet = page.getByRole("dialog", { name: "특기" });
  const fight = sheet.getByRole("region", { name: "간부전" });
  await expect(fight).toContainText("성문 앞 결투");
  await expect(fight).toContainText("제1판");
  await sheet.getByRole("radio", { name: /쾌검/ }).click();
  await expect(sheet.getByRole("checkbox", { name: /「성문 앞 결투」에 걸기/ })).toBeChecked();
  await sheet.getByRole("button", { name: /결제 · 300/ }).click();
  await expect(fight).toContainText("에이든 · 쾌검", { timeout: 15_000 });
  await page.screenshot({ path: "test-results/shots/60-story-fight.png", animations: "disabled" });
  await sheet.getByRole("button", { name: "닫기" }).first().click();

  // With scenes off, the city tab is the line map, the board and the notebook (no character to make).
  await page.getByRole("link", { name: /도시/ }).click();

  // The notebook: the back of the card is only for its holder.
  await page.getByRole("button", { name: "단서 수첩" }).click();
  const notebook = page.getByRole("dialog", { name: "단서 수첩" });
  await notebook.getByRole("button", { name: /봉인된 양피지 사본/ }).click();
  await expect(notebook).toContainText("뒷면에 적힌 비밀.");
  await page.screenshot({ path: "test-results/shots/61-story-notebook.png", animations: "disabled" });
  await notebook.getByRole("button", { name: "닫기" }).first().click();

  // The board: Loenheim's clock at 2/4 with that step's notice; the ledger with the collateral page wiped.
  await page.getByRole("button", { name: "📋 역 게시판" }).click();
  const board = page.getByRole("dialog", { name: "역 게시판" });
  await expect(board).toContainText(FRONT_TEXT.medieval[1]!.official);
  await expect(board.getByLabel("전선 시계 2/4").first()).toBeVisible();
  await page.screenshot({ path: "test-results/shots/62-story-board.png", animations: "disabled" });
  await board.getByRole("tab", { name: "가죽 장부" }).click();
  await expect(board).toContainText("지워진 쪽");
  await expect(board).toContainText("셋째 쪽 제목");
  await page.screenshot({ path: "test-results/shots/63-story-ledger.png", animations: "disabled" });
  expect(errors).toEqual([]);
});
