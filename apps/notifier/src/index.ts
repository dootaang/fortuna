import { formatNotification, normalizeNotify, type NotifyEvent } from "@fortuna/core";
import { FirestoreRest } from "./firestore-rest.ts";
import { MarketClock, type RecorderEnv } from "./oracle.ts";

export { MarketClock };

interface ClockNamespace { idFromName(name: string): unknown; get(id: unknown): { fetch(url: string): Promise<Response> }; }

export interface Env extends Partial<RecorderEnv> {
  /** Durable Object namespace of the market clock (wrangler.toml). */
  CLOCK?: ClockNamespace;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
  DISCORD_WEBHOOK_URL: string;
  /** Tests point this at the emulator. */
  FIRESTORE_HOST?: string;
}

/** Event kinds and the notify toggle that governs each. */
const TOGGLE: Record<string, NotifyEvent> = {
  arrival: "arrival", bigGamble: "bigGamble", skill: "skill", shop: "shop", fundFilled: "fundFilled", repaid: "repaid", liberation: "liberation", houseOpen: "houseOpen", pvpOpen: "pvp", pvpWin: "pvp", marketWin: "market", marketLoss: "market",
};

function cors(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((entry) => entry.trim());
  return origin && allowed.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", Vary: "Origin" }
    : {};
}

function reply(status: number, body: Record<string, unknown>, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/**
 * POST { eventId } with `Authorization: Bearer <Firebase ID token>`.
 * Every read goes through Firestore with the caller's token, so a caller can
 * only relay events that the security rules let them read — their own.
 */
export async function relay(eventId: string, idToken: string, env: Env, post: typeof fetch = fetch): Promise<{ status: string }> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) return { status: "bad-id" };
  const firestore = new FirestoreRest(env.FIREBASE_PROJECT_ID, idToken, env.FIRESTORE_HOST);
  const event = await firestore.get(`events/${eventId}`);
  if (!event) return { status: "not-found" };
  if (event.data.sentAt) return { status: "already-sent" };

  const kind = String(event.data.kind ?? "");
  const notify = normalizeNotify((await firestore.get("config/notify"))?.data);
  const toggle = TOGGLE[kind];
  if (!toggle || !notify.enabled[toggle]) { await firestore.markSent(event.name, event.updateTime); return { status: "disabled" }; }

  let detail: Record<string, unknown> = {}, playerName = "", districtId = "", delta = 0;
  const ledgerId = typeof event.data.ledgerId === "string" ? event.data.ledgerId : null;
  const playerId = typeof event.data.playerId === "string" ? event.data.playerId : null;
  if (ledgerId) {
    const entry = (await firestore.get(`ledger/${ledgerId}`))?.data;
    detail = (entry?.detail as Record<string, unknown> | undefined) ?? {};
    delta = Number(entry?.delta ?? 0);
  }
  if (playerId) {
    const player = await firestore.get(`players/${playerId}`);
    playerName = String(player?.data.name ?? "어느 승객");
    districtId = String(player?.data.districtId ?? "");
  }
  const text = formatNotification({ kind, playerName, districtId, detail, delta, payload: (event.data.payload as Record<string, unknown>) ?? {} }, notify.bigGamble);
  // Claim the event first so concurrent calls cannot double-post.
  if (!(await firestore.markSent(event.name, event.updateTime))) return { status: "already-sent" };
  if (!text) return { status: "skipped" };

  const response = await post(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "포르투나의 지배인", content: text, allowed_mentions: { parse: [] } }),
  });
  if (!response.ok) throw new Error(`discord_${response.status}`);
  return { status: "sent" };
}

export default {
  /** Every minute: make sure the market clock (a Durable Object alarm, every 15 s) is running. */
  async scheduled(_controller: { scheduledTime: number }, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    if (!env.CLOCK) return;
    ctx.waitUntil(env.CLOCK.get(env.CLOCK.idFromName("market")).fetch("https://clock/arm").catch((error) => console.error("arm", error)));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = cors(request.headers.get("Origin"), env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply(405, { error: "method" }, headers);
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!token) return reply(401, { error: "token" }, headers);
    if (!env.DISCORD_WEBHOOK_URL) return reply(503, { error: "webhook-not-configured" }, headers);
    let eventId = "";
    try { eventId = String(((await request.json()) as { eventId?: unknown }).eventId ?? ""); } catch { return reply(400, { error: "body" }, headers); }
    try {
      return reply(200, await relay(eventId, token, env), headers);
    } catch (error) {
      return reply(502, { error: error instanceof Error ? error.message : "relay" }, headers);
    }
  },
};
