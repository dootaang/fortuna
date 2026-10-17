import { expect, test } from "@playwright/test";
import { LINES, LINE_IDS, STATIONS, stationsOf } from "@fortuna/core";
import { getDoc } from "firebase/firestore";
import {
  adjustWallet, cityRefs, ensurePresetNpcs, moveTo, openSession, placeChannel, saveCharacter, sendMessage, setCityScenes, setPersistentEffect, setStageNpcs, whisperChannel,
} from "@fortuna/data";
import { allowDealer, makePng, playSomeGames, resetEmulators, seedCity, seedPlayers, signInWithGooglePopup, withDealer, withPlayer, type SeededCity } from "./seed.ts";

let city: SeededCity;
let friend: string;
let friendPid: string;

test.beforeAll(async () => {
  await resetEmulators();
  city = await seedCity();
  await playSomeGames(city.code, 0);
  [friend] = await seedPlayers(["벨라"]);
  await playSomeGames(friend!, 0);
  // A second passenger already standing in the plaza.
  friendPid = await withPlayer(friend!, async (session) => {
    await saveCharacter(session, "벨라", { skin: 0, hair: 2, hairColor: 5, outfit: 5, outfitColor: 2, accessory: 4 }, null);
    return session.pid;
  });
  await withDealer("dealer@example.com", async (session) => {
    await setCityScenes(session, true);
    await adjustWallet(session, city.pid, { delta: 5_000, debtDelta: 0, memo: "도시 시험 지원금" });
    await ensurePresetNpcs(session);
    await openSession(session, "1화 — 휠 광장의 밤");
    await setStageNpcs(session, "wheel-plaza", ["manager"]);
    await sendMessage(session, session.uid, { authorKind: "narration" }, placeChannel("wheel-plaza"), "> 막차가 들어온다. 분수 위의 휠이 한 칸 돈다.", { place: "wheel-plaza" });
  });
});

test("city: character, scene, chat, skill, line map, whisper and records", async ({ page }) => {
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

  // The plaza scene: default art, the manager on stage, Bella present, the narration in chat.
  await expect(page.getByRole("figure", { name: "휠 광장 장면" })).toBeVisible();
  const presence = page.getByLabel("여기 있는 사람");
  await expect(presence).toContainText("지배인");
  await expect(presence).toContainText("벨라");
  await expect(page.getByText("막차가 들어온다.")).toBeVisible();
  await expect(page.getByText("세션 진행 중 · 1화 — 휠 광장의 밤")).toBeVisible();

  // Talk, act, roll; Bella and the manager answer.
  const input = page.getByLabel("메시지");
  await input.fill("**행운이 함께하기를.** 여기가 휠 광장인가.");
  await input.press("Enter");
  await expect(page.locator("li", { hasText: "여기가 휠 광장인가." })).toBeVisible();
  await input.fill("*분수 쪽으로 동전을 던진다*");
  await input.press("Enter");
  await input.fill("/주사위 2d6+1");
  await input.press("Enter");
  await expect(page.locator("li", { hasText: "2d6+1" }).locator("strong")).toHaveText(/^\d+$/, { timeout: 10_000 });
  await withPlayer(friend, (session) => sendMessage(session, session.pid, { authorKind: "pc", name: "벨라" }, placeChannel("wheel-plaza"), "어서 와요. 여긴 처음이죠?", { place: "wheel-plaza" }));
  await withDealer("dealer@example.com", (session) => sendMessage(session, session.uid, { authorKind: "npc", npcId: "manager", name: "지배인" }, placeChannel("wheel-plaza"), "포르투나에 오신 것을 환영합니다, 손님.", { place: "wheel-plaza" }));
  await expect(page.locator("li", { hasText: "환영합니다, 손님" })).toContainText("NPC");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/shots/41-city-scene.png", animations: "disabled" });

  // Pay for a skill from the chat: the payment card lands in the scene.
  await page.getByRole("button", { name: "주사위와 행동" }).click();
  await page.getByRole("button", { name: "✦ 특기 쓰기 (결제)" }).click();
  const sheet = page.getByRole("dialog", { name: "특기 쓰기" });
  await sheet.getByRole("radio", { name: /쾌검/ }).click();
  await sheet.getByRole("button", { name: "점수 올리기" }).click();
  await sheet.getByLabel("장면에 남길 한 줄 (선택)").fill("소매를 털고 검을 뽑는다");
  await sheet.getByRole("button", { name: "쾌검 5점 쓰기" }).click();
  await expect(sheet).toBeHidden();
  const stamp = page.locator("li", { hasText: "소매를 털고 검을 뽑는다" });
  await expect(stamp).toContainText("쾌검");
  await expect(stamp).toContainText("5점");

  // Pin a line as a 명장면.
  const line = page.locator("li", { hasText: "여기가 휠 광장인가." });
  await line.hover();
  await line.getByRole("button", { name: "명장면으로 남기기" }).click();
  await expect(line.getByRole("button", { name: "명장면에서 빼기" })).toBeVisible();

  // A whisper arrives: the tab shows a dot, and only the two of us can read it.
  await withPlayer(friend, (session) => sendMessage(session, session.pid, { authorKind: "pc", name: "벨라" }, whisperChannel(session.pid, city.pid), "지배인을 너무 믿지 마요."));
  await expect(page.getByLabel("새 귓속말").first()).toBeVisible();
  await page.getByRole("tab", { name: /귓속말/ }).click();
  await page.getByRole("button", { name: /^벨라/ }).click();
  await expect(page.getByText("지배인을 너무 믿지 마요.")).toBeVisible();
  await input.fill("알았어요. 고마워요.");
  await input.press("Enter");
  await expect(page.locator("li", { hasText: "알았어요. 고마워요." })).toBeVisible();
  const whisper = await withPlayer(city.code, async (session) => (await getDoc(cityRefs.actor(session.db, session.pid))).data());
  expect(whisper?.place).toBe("wheel-plaza");
  void friendPid;

  // Take the line to 취선포.
  await page.getByRole("button", { name: "노선도" }).click();
  await expect(page.getByRole("group", { name: "포르투나 노선도" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/shots/42-city-linemap.png", animations: "disabled" });
  await page.getByRole("button", { name: /^취선포/ }).click();
  await expect(page.getByText("객잔 등롱, 술 냄새")).toBeVisible();
  await page.getByRole("button", { name: "이 역으로 가기" }).click();
  await expect(page.getByRole("figure", { name: "취선포 장면" })).toBeVisible();
  await withDealer("dealer@example.com", (session) => setPersistentEffect(session, "zhong-chwiseon", "rain"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/shots/43-city-chwiseon-rain.png", animations: "disabled" });

  // Records: the pinned line and the session log.
  await page.getByRole("button", { name: "기록과 명장면" }).click();
  await expect(page.getByText("여기가 휠 광장인가.")).toBeVisible();
  await page.getByRole("tab", { name: "세션 기록" }).click();
  await expect(page.getByText("1화 — 휠 광장의 밤")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "기록 받기 (.md)" }).click();
  const log = await (await download).createReadStream().then(async (stream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  });
  expect(log).toContain("# 1화 — 휠 광장의 밤");
  expect(log).toContain("여기가 휠 광장인가.");
  expect(log).toContain("쾌검 5점");
  expect(log).not.toContain("지배인을 너무 믿지 마요."); // whispers stay out
  await page.getByRole("button", { name: "← 장면으로" }).click();

  // Every district's default card, wide.
  await page.setViewportSize({ width: 1280, height: 860 });
  for (const lineId of LINE_IDS) {
    const station = lineId === "wheel" ? STATIONS["wheel-exchange"] : stationsOf(lineId)[1]!;
    await withPlayer(city.code, (session) => moveTo(session, station.id));
    await expect(page.getByRole("figure", { name: `${station.name} 장면` })).toBeVisible();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `test-results/shots/44-city-${lineId}.png`, animations: "disabled" });
    void LINES;
  }
  expect(errors).toEqual([]);
});

test("dealer city console: upload a background, put it live, speak as an NPC", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dealer");
  await signInWithGooglePopup(page, "dealer@example.com");
  const onboarding = page.getByRole("heading", { name: "딜러 등록이 필요합니다" });
  const shell = page.getByText("딜러 화면");
  await expect(onboarding.or(shell)).toBeVisible({ timeout: 20_000 });
  if (await onboarding.isVisible()) {
    await allowDealer((await page.locator("code").first().textContent())!.trim());
    await expect(shell).toBeVisible();
  }
  await page.getByRole("button", { name: "도시", exact: true }).click();
  await page.getByRole("button", { name: "장면 콘솔", exact: true }).click();
  await expect(page.getByRole("figure", { name: "휠 광장 장면" })).toBeVisible();

  // Upload a background for the plaza and put it on stage.
  await page.locator("section", { hasText: "이 장소의 배경" }).locator("input[type=file]").setInputFiles({ name: "plaza-night.png", mimeType: "image/png", buffer: await makePng() });
  const thumb = page.getByRole("button", { name: "plaza-night 설정" });
  await expect(thumb).toBeVisible({ timeout: 20_000 });
  await page.getByTitle("장면에 걸기").first().click();
  await expect(page.locator(".scene-card img.scene-img")).toBeVisible();
  await page.getByRole("button", { name: "강하게" }).click();
  await page.getByLabel("출처 (화면 구석에 작게)").fill("딜러 사진");
  await page.getByRole("button", { name: "글 저장" }).click();
  await expect(page.locator(".scene-credit")).toHaveText("딜러 사진");

  // Effects and an NPC line.
  await page.getByRole("button", { name: "⚡ 흔들림" }).click();
  await page.getByRole("button", { name: "안개" }).click();
  await page.getByLabel("NPC로 말하기").selectOption({ label: "지배인" });
  const input = page.getByLabel("메시지");
  await input.fill("오늘 밤의 판돈은 제가 정하겠습니다.");
  await input.press("Enter");
  await expect(page.locator("li", { hasText: "오늘 밤의 판돈은" })).toContainText("지배인");
  await page.getByRole("button", { name: "서술" }).click();
  await input.fill("> 샹들리에가 한 번 깜빡인다.");
  await input.press("Enter");
  await expect(page.locator(".narration", { hasText: "샹들리에가" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "test-results/shots/50-dealer-city.png", fullPage: true, animations: "disabled" });

  // The player sees the same scene image.
  const scene = await withPlayer(city.code, async (session) => (await getDoc(cityRefs.scene(session.db, "wheel-plaza"))).data());
  expect(scene?.imageId).toBeTruthy();
  expect(scene?.persistent).toBe("fog");

  // NPC tab: presets exist; open one.
  await page.getByRole("button", { name: "NPC", exact: true }).click();
  await page.getByRole("button", { name: /금만량/ }).click();
  await expect(page.getByLabel("비밀 메모 (딜러만)")).toBeVisible();
  expect(errors).toEqual([]);
});
