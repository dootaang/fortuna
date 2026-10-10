/** Minimal Firestore REST client that acts as the signed-in user, so security rules still apply. */

type Value =
  | { nullValue: null } | { booleanValue: boolean } | { integerValue: string } | { doubleValue: number } | { stringValue: string }
  | { timestampValue: string } | { mapValue: { fields?: Record<string, Value> } } | { arrayValue: { values?: Value[] } };

export interface RestDocument { name: string; fields?: Record<string, Value>; updateTime: string; }

export function decode(value: Value): unknown {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("mapValue" in value) return decodeFields(value.mapValue.fields ?? {});
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decode);
  return undefined;
}

export function decodeFields(fields: Record<string, Value>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}

export class FirestoreRest {
  constructor(private readonly projectId: string, private readonly idToken: string, private readonly host = "https://firestore.googleapis.com") {}

  private get base() { return `${this.host}/v1/projects/${this.projectId}/databases/(default)/documents`; }

  /** null when missing or not readable by this user. */
  async get(path: string): Promise<{ data: Record<string, unknown>; updateTime: string; name: string } | null> {
    const response = await fetch(`${this.base}/${path}`, { headers: { Authorization: `Bearer ${this.idToken}` } });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw new Error(`firestore_get_${response.status}`);
    const document = (await response.json()) as RestDocument;
    return { data: decodeFields(document.fields ?? {}), updateTime: document.updateTime, name: document.name };
  }

  /**
   * Stamp `sentAt` with the server time, only if nobody else did since `updateTime`.
   * Returns false when another request won the race.
   */
  async markSent(documentName: string, updateTime: string): Promise<boolean> {
    const response = await fetch(`${this.base}:commit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        writes: [{
          transform: { document: documentName, fieldTransforms: [{ fieldPath: "sentAt", setToServerValue: "REQUEST_TIME" }] },
          currentDocument: { updateTime },
        }],
      }),
    });
    if (response.ok) return true;
    if (response.status === 400 || response.status === 409 || response.status === 412 || response.status === 403) return false;
    throw new Error(`firestore_commit_${response.status}`);
  }
}
