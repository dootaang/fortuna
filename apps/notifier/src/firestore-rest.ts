/** Minimal Firestore REST client that acts as the signed-in user, so security rules still apply. */

export type Value =
  | { nullValue: null } | { booleanValue: boolean } | { integerValue: string } | { doubleValue: number } | { stringValue: string }
  | { timestampValue: string } | { mapValue: { fields?: Record<string, Value> } } | { arrayValue: { values?: Value[] } };

export interface RestDocument { name: string; fields?: Record<string, Value>; updateTime: string; }
export interface Doc { name: string; id: string; data: Record<string, unknown>; updateTime: string; }

/** Marks a value to be written as a Firestore timestamp. */
export class Stamp { constructor(readonly ms: number) {} }

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

export function encode(value: unknown): Value {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Stamp) return { timestampValue: new Date(value.ms).toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  throw new Error(`cannot encode ${typeof value}`);
}

export function encodeFields(data: Record<string, unknown>): Record<string, Value> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
}

function toDoc(document: RestDocument): Doc {
  return { name: document.name, id: document.name.split("/").pop() ?? "", data: decodeFields(document.fields ?? {}), updateTime: document.updateTime };
}

export type Precondition = { updateTime: string } | { exists: boolean };
export type Write =
  | { update: { name: string; fields: Record<string, Value> }; updateMask?: { fieldPaths: string[] }; currentDocument?: Precondition }
  | { transform: { document: string; fieldTransforms: unknown[] }; currentDocument?: Precondition };

export class CommitConflict extends Error { constructor(status: number) { super(`commit_conflict_${status}`); } }

export class FirestoreRest {
  constructor(private readonly projectId: string, private readonly idToken: string, private readonly host = "https://firestore.googleapis.com") {}

  get root() { return `projects/${this.projectId}/databases/(default)/documents`; }
  private get base() { return `${this.host}/v1/${this.root}`; }
  private headers() { return { Authorization: `Bearer ${this.idToken}`, "Content-Type": "application/json" }; }
  name(path: string) { return `${this.root}/${path}`; }

  /** null when missing or not readable by this user. `mask` limits the fields returned. */
  async get(path: string, mask?: string[]): Promise<Doc | null> {
    const query = mask ? `?${mask.map((field) => `mask.fieldPaths=${encodeURIComponent(field)}`).join("&")}` : "";
    const response = await fetch(`${this.base}/${path}${query}`, { headers: { Authorization: `Bearer ${this.idToken}` } });
    if (response.status === 404 || response.status === 403) return null;
    if (!response.ok) throw new Error(`firestore_get_${response.status}`);
    return toDoc((await response.json()) as RestDocument);
  }

  async list(collection: string): Promise<Doc[]> {
    const response = await fetch(`${this.base}/${collection}?pageSize=300`, { headers: { Authorization: `Bearer ${this.idToken}` } });
    if (!response.ok) throw new Error(`firestore_list_${response.status}`);
    return (((await response.json()) as { documents?: RestDocument[] }).documents ?? []).map(toDoc);
  }

  /** Equality filters only, which is all the recorder needs. */
  async query(collection: string, where: Record<string, unknown>, limit = 200): Promise<Doc[]> {
    const filters = Object.entries(where).map(([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: encode(value) } }));
    const structuredQuery = {
      from: [{ collectionId: collection }], limit,
      ...(filters.length === 1 ? { where: filters[0] } : filters.length > 1 ? { where: { compositeFilter: { op: "AND", filters } } } : {}),
    };
    const response = await fetch(`${this.base}:runQuery`, { method: "POST", headers: this.headers(), body: JSON.stringify({ structuredQuery }) });
    if (!response.ok) throw new Error(`firestore_query_${response.status}`);
    const rows = (await response.json()) as { document?: RestDocument }[];
    return rows.flatMap((row) => (row.document ? [toDoc(row.document)] : []));
  }

  /** count(*) of `collection` where field == value and timeField >= sinceMs. */
  async countSince(collection: string, field: string, value: string, timeField: string, sinceMs: number): Promise<number> {
    const structuredAggregationQuery = {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { compositeFilter: { op: "AND", filters: [
          { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: encode(value) } },
          { fieldFilter: { field: { fieldPath: timeField }, op: "GREATER_THAN_OR_EQUAL", value: encode(new Stamp(sinceMs)) } },
        ] } },
      },
      aggregations: [{ alias: "n", count: {} }],
    };
    const response = await fetch(`${this.base}:runAggregationQuery`, { method: "POST", headers: this.headers(), body: JSON.stringify({ structuredAggregationQuery }) });
    if (!response.ok) throw new Error(`firestore_count_${response.status}: ${(await response.text()).slice(0, 300)}`);
    const rows = (await response.json()) as { result?: { aggregateFields?: { n?: Value } } }[];
    const n = rows[0]?.result?.aggregateFields?.n;
    return n ? Number(decode(n)) : 0;
  }

  /**
   * count(*) or sum(field) of `collection` matching equalities
   * (거래소 2부: resident activity, about one read per aggregation).
   */
  async aggregate(collection: string, equal: Record<string, unknown>, op: { count: true } | { sum: string }): Promise<number> {
    // Equality filters only: Firestore serves them by merging single-field indexes, so no composite index is needed.
    const filters = Object.entries(equal).map(([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: encode(value) } }));
    const structuredAggregationQuery = {
      structuredQuery: { from: [{ collectionId: collection }], where: filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } } },
      aggregations: [{ alias: "n", ...("count" in op ? { count: {} } : { sum: { field: { fieldPath: op.sum } } }) }],
    };
    const response = await fetch(`${this.base}:runAggregationQuery`, { method: "POST", headers: this.headers(), body: JSON.stringify({ structuredAggregationQuery }) });
    if (!response.ok) throw new Error(`firestore_aggregate_${response.status}: ${(await response.text()).slice(0, 300)}`);
    const rows = (await response.json()) as { result?: { aggregateFields?: { n?: Value } } }[];
    const n = rows[0]?.result?.aggregateFields?.n;
    return n ? Number(decode(n)) : 0;
  }

  /** Atomic multi-write. Throws CommitConflict when a precondition fails. Returns each write's updateTime. */
  async commit(writes: Write[]): Promise<string[]> {
    const response = await fetch(`${this.base}:commit`, { method: "POST", headers: this.headers(), body: JSON.stringify({ writes }) });
    if (response.status === 400 || response.status === 409 || response.status === 412) {
      const text = await response.text();
      if (/FAILED_PRECONDITION|ABORTED|ALREADY_EXISTS|NOT_FOUND|precondition|exist/i.test(text)) throw new CommitConflict(response.status);
      throw new Error(`firestore_commit_${response.status}: ${text.slice(0, 300)}`);
    }
    if (!response.ok) throw new Error(`firestore_commit_${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = (await response.json()) as { writeResults?: { updateTime?: string }[]; commitTime?: string };
    return (body.writeResults ?? []).map((result) => result.updateTime ?? body.commitTime ?? "");
  }

  /**
   * Stamp `sentAt` with the server time, only if nobody else did since `updateTime`.
   * Returns false when another request won the race.
   */
  async markSent(documentName: string, updateTime: string): Promise<boolean> {
    try {
      await this.commit([{
        transform: { document: documentName, fieldTransforms: [{ fieldPath: "sentAt", setToServerValue: "REQUEST_TIME" }] },
        currentDocument: { updateTime },
      }]);
      return true;
    } catch (error) {
      if (error instanceof CommitConflict || (error instanceof Error && /firestore_commit_(400|403|409|412)/.test(error.message))) return false;
      throw error;
    }
  }
}
