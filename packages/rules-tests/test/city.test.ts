import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { DEFAULT_SPRITE } from "@fortuna/core";
import {
  arrive, cityHeartbeat, cityRefs, closeSession, deleteMessage, editMessage, ensurePresetNpcs, markRead, moveTo, openSession, parseChatInput, pinMessage,
  placeChannel, saveCharacter, sendMessage, sessionLog, setPortrait, setSceneImage, paySkillInChat, whisperChannel, adjustWallet,
  type PlayerSession, type Session,
} from "@fortuna/data";
import { addPlayer, anonymousSession, cityWithPlayer, closeAll, resetData, rootData } from "./harness.ts";

const denied = async (promise: Promise<unknown>) => { await expect(promise).rejects.toMatchObject({ code: "permission-denied" }); };

let admin: Session, player: PlayerSession, other: PlayerSession, third: PlayerSession;
const me = () => ({ authorKind: "pc" as const, name: "에이든" });

/** A sceneImages document as uploadSceneImage would write it (the file itself is the Storage emulator's business). */
async function imageDoc(session: Session, id: string, owner: "place" | "npc" | "player" | "cut", ref: string) {
  await setDoc(cityRefs.image(session.db, id), {
    owner, ref, path: `uploads/${session.uid}/${id}.webp`, url: "https://example.test/x.webp", name: "그림", filter: "soft", focus: "center", sense: "", credit: "",
    createdAt: serverTimestamp() as never, createdBy: session.uid,
  });
}

beforeEach(async () => {
  await resetData();
  ({ admin, player } = await cityWithPlayer());
  other = await addPlayer(admin, "벨라");
  third = await addPlayer(admin, "카이");
  for (const p of [player, other, third]) await arrive(p);
  await saveCharacter(player, "에이든", DEFAULT_SPRITE, null);
  await saveCharacter(other, "벨라", DEFAULT_SPRITE, null);
});
afterAll(closeAll);

describe("characters", () => {
  it("moves, reads and restyles only your own character", async () => {
    await moveTo(player, "zhong-chwiseon");
    await markRead(player, "zhong-chwiseon");
    await cityHeartbeat(player);
    expect(await rootData(`actors/${player.pid}`)).toMatchObject({ place: "zhong-chwiseon", portrait: null });
    expect(Object.keys((await rootData(`reads/${player.pid}`))!)).toEqual(["zhong-chwiseon"]);
    await denied(updateDoc(cityRefs.actor(other.db, player.pid), { place: "wheel-plaza", seenAt: serverTimestamp() }));
    await denied(getDoc(cityRefs.reads(other.db, player.pid)));
    const stranger = await anonymousSession();
    await denied(getDoc(doc(stranger.db, "actors", player.pid)));
  });

  it("uses only your own uploaded portrait", async () => {
    await imageDoc(player, "mine", "player", player.pid);
    await denied(imageDoc(player, "fake-place", "place", "wheel-plaza"));
    await denied(imageDoc(player, "for-bella", "player", other.pid));
    await setPortrait(player, "mine");
    await imageDoc(other, "hers", "player", other.pid);
    await denied(setPortrait(player, "hers"));
  });
});

describe("chat", () => {
  it("speaks, acts, rolls, edits, deletes and pins in public channels", async () => {
    const id = await sendMessage(player, player.pid, me(), placeChannel("wheel-plaza"), "**행운이 함께하기를.**", { place: "wheel-plaza" });
    expect(await rootData("placeActivity/wheel-plaza")).toMatchObject({ lastName: "에이든" });
    await editMessage(player, id, "행운이 함께하기를.");
    await denied(editMessage(other, id, "가로채기"));
    await pinMessage(other, id, true);
    expect(await rootData(`messages/${id}`)).toMatchObject({ pinned: true, text: "행운이 함께하기를." });
    await deleteMessage(player, id);
    const roll = await sendMessage(player, player.pid, me(), "global", "2d6+1", { kind: "roll" });
    await denied(editMessage(player, roll, "6d6"));
    await denied(sendMessage(player, player.pid, { authorKind: "pc", name: "지배인" }, "global", "사칭"));
    await denied(sendMessage(player, player.pid, { authorKind: "npc", npcId: "manager", name: "지배인" }, "global", "사칭"));
    const pinned = await getDocs(query(cityRefs.messages(other.db), where("pinned", "==", true), where("public", "==", true), orderBy("at", "desc"), limit(10)));
    expect(pinned.size).toBe(1); // deleting keeps the pin; the list hides deleted ones
  });

  it("keeps whispers between the two (and the dealer)", async () => {
    const channel = whisperChannel(player.pid, other.pid);
    await sendMessage(player, player.pid, me(), channel, "비밀이야");
    const mine = await getDocs(query(cityRefs.messages(other.db), where("channel", "==", channel)));
    expect(mine.docs.map((row) => row.data().text)).toEqual(["비밀이야"]);
    await denied(getDocs(query(cityRefs.messages(third.db), where("channel", "==", channel))));
    await denied(sendMessage(third, third.pid, { authorKind: "pc", name: "카이" }, channel, "끼어들기"));
    expect((await getDocs(query(cityRefs.messages(admin.db), where("channel", "==", channel)))).size).toBe(1);
    await sendMessage(admin, admin.uid, { authorKind: "gm" }, whisperChannel("gm", other.pid), "딜러의 귓속말");
    await denied(getDocs(query(cityRefs.messages(player.db), where("channel", "==", whisperChannel("gm", other.pid)))));
    // A whisper inbox: every channel of mine in one query.
    const inbox = await getDocs(query(cityRefs.messages(other.db), where("channel", "in", [channel, whisperChannel(other.pid, third.pid), whisperChannel("gm", other.pid)]), orderBy("at", "desc"), limit(30)));
    expect(inbox.size).toBe(2);
    await denied(getDocs(query(cityRefs.messages(third.db), where("channel", "in", [channel, whisperChannel(third.pid, other.pid)]), orderBy("at", "desc"), limit(30))));
  });

  it("lets the dealer narrate, speak as a real NPC and show an image", async () => {
    await ensurePresetNpcs(admin);
    await sendMessage(admin, admin.uid, { authorKind: "narration" }, placeChannel("zhong-chwiseon"), "> 객잔 문이 열린다.", { place: "zhong-chwiseon" });
    await sendMessage(admin, admin.uid, { authorKind: "npc", npcId: "geum-manryang", name: "금만량" }, placeChannel("zhong-chwiseon"), "이번 달은 삼백 코인이오.");
    await denied(sendMessage(admin, admin.uid, { authorKind: "npc", npcId: "geum-manryang", name: "천마" }, "global", "이름 틀림"));
    await imageDoc(admin, "cut1", "cut", "");
    await sendMessage(admin, admin.uid, { authorKind: "narration" }, "global", "흑전각의 문", { kind: "image", imageId: "cut1" });
    await setSceneImage(admin, "zhong-chwiseon", null);
    await denied(setSceneImage(player, "zhong-chwiseon", null));
  });

  it("shows a skill payment once, matching the ledger", async () => {
    await adjustWallet(admin, player.pid, { delta: 5_000, debtDelta: 0, memo: "테스트 지원" });
    const id = await paySkillInChat(player, "에이든", "wheel-plaza", { skillId: "sword", usedLevel: 5, note: "검을 뽑는다", borrow: false });
    const message = (await rootData(`messages/${id}`))!;
    expect(message.skill).toEqual({ name: "검술", base: 4, used: 5, cost: 1_300 });
    await denied(editMessage(player, id, "다른 말"));
    // Re-using the same ledger entry, or inflating the cost, is refused.
    const ledgerId = message.ledgerId as string;
    await denied(setDoc(cityRefs.message(player.db, `skill_${ledgerId}_x`), { ...message, at: serverTimestamp() } as never));
    const batch = writeBatch(other.db);
    batch.set(cityRefs.message(other.db, `skill_${ledgerId}`), { ...message, authorId: other.pid, authorName: "벨라", at: serverTimestamp() } as never);
    await denied(batch.commit());
  });

  it("files messages under a live session and exports its log", async () => {
    const sessionId = await openSession(admin, "첫 세션");
    await sendMessage(player, player.pid, me(), placeChannel("wheel-plaza"), "안녕", { sessionId, place: "wheel-plaza" });
    await sendMessage(player, player.pid, me(), whisperChannel(player.pid, other.pid), "몰래", { sessionId });
    const log = await sessionLog(other.db, sessionId, "첫 세션", (channel) => channel);
    expect(log).toContain("안녕");
    expect(log).not.toContain("몰래");
    await closeSession(admin, sessionId);
    await denied(sendMessage(player, player.pid, me(), "global", "늦었다", { sessionId }));
  });

  it("reads typed commands", () => {
    const skills = [{ id: "sword", name: "검술" }], people = [{ id: "p2", name: "벨라" }];
    expect(parseChatInput("/주사위 2D6 + 1")).toEqual({ kind: "roll", text: "2d6+1" });
    expect(parseChatInput("/행동 잔을 내려놓는다")).toEqual({ kind: "act", text: "잔을 내려놓는다" });
    expect(parseChatInput("*잔을 내려놓는다*")).toEqual({ kind: "act", text: "잔을 내려놓는다" });
    expect(parseChatInput("/특기 검술 5", skills)).toEqual({ kind: "skill", skillId: "sword", usedLevel: 5 });
    expect(parseChatInput("/귓 벨라 내일 봐", skills, people)).toEqual({ kind: "whisper", to: "p2", text: "내일 봐" });
    expect(parseChatInput("/주사위 사과")).toHaveProperty("error");
  });
});
