import { relayEvent } from "@fortuna/data";
import { auth } from "./firebase.ts";

/**
 * Fire-and-forget: ask the Worker to post an event to Discord. Unknown ids
 * (an op that created no event) come back as "not-found" and are ignored.
 * Anything that fails here is listed on the dealer's notification page for resending.
 */
export function relay(relayUrl: string, eventId: string | null | undefined): void {
  if (!relayUrl || !eventId) return;
  const user = auth.currentUser;
  if (!user) return;
  void user.getIdToken().then((token) => relayEvent(relayUrl, token, eventId));
}
