import { expect, test } from "@playwright/test";
import { PLACE_IDS, PLACES } from "@fortuna/core";
import { getDoc } from "firebase/firestore";
import { cityRefs, enterPlace, saveCharacter, sendMessage } from "@fortuna/data";
import { playSomeGames, resetEmulators, seedCity, seedPlayers, withPlayer, type SeededCity } from "./seed.ts";

let city: SeededCity;
let friend: string;

test.beforeAll(async () => {
  await resetEmulators();
  city = await seedCity();
  await playSomeGames(city.code, 0);
  [friend] = await seedPlayers(["벨라"]);
  await playSomeGames(friend!, 0);
  // A second passenger already standing in the plaza.
  await withPlayer(friend!, (session) => saveCharacter(session, "벨라", { skin: 0, hair: 2, hairColor: 5, outfit: 5, outfitColor: 2, accessory: 4 }, null));
});

test("city: make a character, walk, talk, roll, and see every place", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByPlaceholder("FRT-XXXX-XXXX-XXXX").fill(city.code);
  await page.getByRole("button", { name: "개찰구 통과" }).click();
  await page.getByRole("link", { name: /도시/ }).click();

  // Character maker on the first visit.
  await expect(page.getByRole("heading", { name: "도시에 들어서기 전에" })).toBeVisible();
  await page.getByRole("button", { name: "도포" }).click();
  await page.getByRole("button", { name: "옷 색 2" }).click();
  await page.getByRole("button", { name: "포니테일" }).click();
  await page.getByRole("button", { name: "뿔" }).click();
  await page.screenshot({ path: "test-results/shots/40-city-maker.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "휠 광장으로 나가기" }).click();

  // The plaza with both characters.
  const map = page.getByRole("img", { name: /휠 광장 지도/ });
  await expect(map).toBeVisible();
  await page.waitForTimeout(1_200);
  await page.screenshot({ path: "test-results/shots/41-city-plaza.png", animations: "disabled" });

  // Walk: tap a little to the right and below.
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.75);
  await page.waitForTimeout(1_500);

  // Keyboard: hold the left arrow (or A) to walk straight, let go to stop.
  const where = () => withPlayer(city.code, async (session) => (await getDoc(cityRefs.actor(session.db, session.pid))).data()!);
  const before = await where();
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(600);
  const after = await where();
  expect(after.tx).toBeLessThan(before.tx);
  expect(after.tx).toBe(after.fx); // stopped
  await page.keyboard.press("KeyW");

  // Talk, act, roll.
  const input = page.getByLabel("메시지");
  await input.fill("**행운이 함께하기를.** 여기가 휠 광장인가.");
  await input.press("Enter");
  await expect(page.locator("li", { hasText: "여기가 휠 광장인가." })).toBeVisible();
  await input.fill("*분수 쪽으로 동전을 던진다*");
  await input.press("Enter");
  await input.fill("/주사위 2d6+1");
  await input.press("Enter");
  await expect(page.locator("li", { hasText: "2d6+1" }).locator("strong")).toHaveText(/^\d+$/, { timeout: 10_000 });
  await withPlayer(friend, (session) => sendMessage(session, "벨라", "place:wheel-plaza", "say", "어서 와요. 여긴 처음이죠?"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/shots/42-city-chat.png", animations: "disabled" });

  // Every place, wide.
  await page.setViewportSize({ width: 1280, height: 860 });
  for (const id of PLACE_IDS) {
    const place = PLACES[id];
    await withPlayer(city.code, (session) => enterPlace(session, id, place.spawn));
    await expect(page.getByRole("img", { name: new RegExp(`${place.name} 지도`) })).toBeVisible();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `test-results/shots/43-city-${id}.png`, animations: "disabled" });
  }
  expect(errors).toEqual([]);
});
