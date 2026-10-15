import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { DEFAULT_SPRITE } from "@fortuna/core";
import {
  arrive, cityRefs, deleteMessage, editMessage, enterPlace, cityHeartbeat, parseChatInput, saveCharacter, sendMessage, walkTo,
  type PlayerSession, type Session,
} from "@fortuna/data";
import { addPlayer, anonymousSession, cityWithPlayer, closeAll, resetData, rootData } from "./harness.ts";

const denied = async (promise: Promise<unknown>) => { await expect(promise).rejects.toMatchObject({ code: "permission-denied" }); };

let admin: Session, player: PlayerSession, other: PlayerSession;

beforeEach(async () => {
  await resetData();
  ({ admin, player } = await cityWithPlayer());
  other = await addPlayer(admin, "벨라");
  await arrive(player);
});
afterAll(closeAll);

describe("actors", () => {
  it("creates, restyles, walks and changes place for your own character only", async () => {
    await saveCharacter(player, "에이든", DEFAULT_SPRITE, null);
    const made = (await rootData(`actors/${player.pid}`))!;
    expect(made).toMatchObject({ place: "wheel-plaza", name: "에이든" });
    expect(Math.abs(made.fx - 14) <= 3 && made.fy >= 6 && made.fy <= 8).toBe(true);
    await walkTo(player, [made.fx, made.fy], [20, 6]);
    expect(await rootData(`actors/${player.pid}`)).toMatchObject({ fx: made.fx, tx: 20 });
    await enterPlace(player, "wheel-pandon", [1, 6]);
    await cityHeartbeat(player);
    const actor = (await getDoc(cityRefs.actor(player.db, player.pid))).data()!;
    await saveCharacter(player, "에이든", { ...DEFAULT_SPRITE, hair: 3 }, actor);
    expect(await rootData(`actors/${player.pid}`)).toMatchObject({ place: "wheel-pandon", sprite: { hair: 3 } });
    // Others can see it but not move it.
    expect((await getDoc(cityRefs.actor(other.db, player.pid))).exists()).toBe(true);
    await denied(updateDoc(cityRefs.actor(other.db, player.pid), { tx: 1, at: serverTimestamp(), seenAt: serverTimestamp() }));
  });

  it("refuses a borrowed name, odd fields and a forged departure time", async () => {
    const base = { kind: "pc", sprite: DEFAULT_SPRITE, place: "wheel-plaza", fx: 1, fy: 1, tx: 1, ty: 1, at: serverTimestamp(), seenAt: serverTimestamp() };
    await denied(setDoc(cityRefs.actor(player.db, player.pid), { ...base, name: "벨라" } as never));
    await denied(setDoc(cityRefs.actor(player.db, player.pid), { ...base, name: "에이든", coins: 5 } as never));
    await denied(setDoc(cityRefs.actor(player.db, player.pid), { ...base, name: "에이든", at: new Date(0) } as never));
    await denied(setDoc(cityRefs.actor(player.db, other.pid), { ...base, name: "벨라" } as never));
    const stranger = await anonymousSession();
    await denied(getDoc(doc(stranger.db, "actors", player.pid)));
  });
});

describe("messages", () => {
  it("sends, edits and deletes your own words; dice stay as rolled", async () => {
    const id = await sendMessage(player, "에이든", "place:wheel-plaza", "say", "**행운이 함께하기를.**");
    await editMessage(player, id, "행운이 함께하기를.");
    expect(await rootData(`messages/${id}`)).toMatchObject({ text: "행운이 함께하기를.", deleted: false });
    await denied(editMessage(other, id, "가로채기"));
    await deleteMessage(player, id);
    expect(await rootData(`messages/${id}`)).toMatchObject({ text: "", deleted: true });
    const roll = await sendMessage(player, "에이든", "global", "roll", "2d6+1");
    await denied(editMessage(player, roll, "6d6"));
    await denied(deleteMessage(player, roll));
    expect((await getDoc(cityRefs.message(other.db, roll))).data()?.text).toBe("2d6+1");
  });

  it("refuses impersonation, bad channels, bad dice and forged times", async () => {
    const base = { channel: "global", kind: "say", authorId: player.pid, authorName: "에이든", text: "hi", at: serverTimestamp(), editedAt: null, deleted: false };
    await denied(addDoc(cityRefs.messages(player.db), { ...base, authorName: "지배인" } as never));
    await denied(addDoc(cityRefs.messages(player.db), { ...base, authorId: other.pid, authorName: "벨라" } as never));
    await denied(addDoc(cityRefs.messages(player.db), { ...base, channel: "admin" } as never));
    await denied(addDoc(cityRefs.messages(player.db), { ...base, kind: "roll", text: "999d6" } as never));
    await denied(addDoc(cityRefs.messages(player.db), { ...base, at: new Date(0) } as never));
    await denied(addDoc(cityRefs.messages(player.db), { ...base, text: "x".repeat(2_001) } as never));
  });

  it("reads typed input as speech, action or dice", () => {
    expect(parseChatInput("/주사위 2D6 + 1")).toEqual({ kind: "roll", text: "2d6+1" });
    expect(parseChatInput("/행동 잔을 내려놓는다")).toEqual({ kind: "act", text: "잔을 내려놓는다" });
    expect(parseChatInput("*잔을 내려놓는다*")).toEqual({ kind: "act", text: "잔을 내려놓는다" });
    expect(parseChatInput("**굵게**")).toEqual({ kind: "say", text: "**굵게**" });
    expect(parseChatInput("/주사위 사과")).toHaveProperty("error");
  });
});
