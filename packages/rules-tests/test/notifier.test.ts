import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "firebase/auth";
import { addDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { normalizeNotify } from "@fortuna/core";
import { arrive, buyItem, refs, saveItem, saveNotify, setDistrict, storyEvent, type Session } from "@fortuna/data";
import { relay, type Env } from "../../../apps/notifier/src/index.ts";
import { anonymousSession, cityWithPlayer, closeAll, resetData } from "./harness.ts";

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const env: Env = { FIREBASE_PROJECT_ID: "demo-fortuna", ALLOWED_ORIGINS: "", DISCORD_WEBHOOK_URL: "https://discord.test/webhook", FIRESTORE_HOST: `http://${host}` };

function discord() {
  const posts: string[] = [];
  const post = (async (_url: unknown, init?: { body?: unknown }) => { posts.push(JSON.parse(String(init?.body)).content); return new Response(null, { status: 204 }); }) as typeof fetch;
  return { posts, post };
}
const token = (session: Session) => getAuth(session.db.app).currentUser!.getIdToken();

beforeEach(resetData);
afterAll(closeAll);

describe("discord relay worker", () => {
  it("posts a player's event once, in the manager's voice", async () => {
    const { player, pid } = await cityWithPlayer();
    await arrive(player);
    const hook = discord();
    expect(await relay(`${pid}_1`, await token(player), env, hook.post)).toEqual({ status: "sent" });
    expect(hook.posts[0]).toContain("에이든");
    expect(hook.posts[0]).toContain("로엔하임");
    expect(await relay(`${pid}_1`, await token(player), env, hook.post)).toEqual({ status: "already-sent" });
    expect(hook.posts).toHaveLength(1);
    expect((await getDoc(refs.event(player.db, `${pid}_1`))).data()?.sentAt).toBeTruthy();
  });

  it("cannot relay someone else's event", async () => {
    const { player, pid } = await cityWithPlayer();
    await arrive(player);
    const stranger = await anonymousSession();
    const hook = discord();
    expect(await relay(`${pid}_1`, await token(stranger), env, hook.post)).toEqual({ status: "not-found" });
    expect(hook.posts).toHaveLength(0);
  });

  it("respects the dealer's toggles and keeps secrets out of shop posts", async () => {
    const { admin, player, pid } = await cityWithPlayer();
    const notify = normalizeNotify((await getDoc(refs.notify(admin.db))).data());
    await saveNotify(admin, { ...notify, enabled: { ...notify.enabled, arrival: false } });
    await arrive(player);
    const hook = discord();
    expect(await relay(`${pid}_1`, await token(player), env, hook.post)).toEqual({ status: "disabled" });
    const itemId = await saveItem(admin, null, { name: "간부의 약점", description: "", price: 100, category: "rumor", stock: null, perPlayerLimit: null, visible: true, consumable: false, hasSecret: true, revealNote: "", sortOrder: 0 }, "오른쪽 무릎");
    const ledgerId = await buyItem(player, itemId);
    expect(await relay(ledgerId, await token(player), env, hook.post)).toEqual({ status: "sent" });
    expect(hook.posts[0]).toContain("간부의 약점");
    expect(hook.posts[0]).not.toContain("오른쪽 무릎");
  });

  it("announces a liberation from the dealer", async () => {
    const { admin } = await cityWithPlayer();
    const eventId = await setDistrict(admin, "horror", { liberated: true, deductionBps: 5_000 }, "간부 격파");
    const hook = discord();
    expect(await relay(eventId!, await token(admin), env, hook.post)).toEqual({ status: "sent" });
    expect(hook.posts[0]).toContain("무월리");
  });

  it("posts the dealer's story lines (fights, clues) as written; players cannot forge one", async () => {
    const { admin, player } = await cityWithPlayer();
    const eventId = await storyEvent(admin, "💰 마왕이 웃돈을 얹었다 — 5점.");
    const hook = discord();
    expect(await relay(eventId, await token(admin), env, hook.post)).toEqual({ status: "sent" });
    expect(hook.posts[0]).toBe("💰 마왕이 웃돈을 얹었다 — 5점.");
    await expect(addDoc(refs.events(player.db), { kind: "story", ledgerId: null, playerId: null, actorUid: getAuth(player.db.app).currentUser!.uid, at: serverTimestamp() as never, sentAt: null, payload: { text: "가짜" } })).rejects.toMatchObject({ code: "permission-denied" });
    const notify = normalizeNotify((await getDoc(refs.notify(admin.db))).data());
    await saveNotify(admin, { ...notify, enabled: { ...notify.enabled, story: false } });
    expect(await relay(await storyEvent(admin, "꺼짐"), await token(admin), env, hook.post)).toEqual({ status: "disabled" });
  });
});
