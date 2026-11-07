/**
 * Private evidence storage. Uses the R2 bucket when it is bound; otherwise falls back to a D1 table,
 * so a deployment without R2 can still accept submissions. Both are server-only: objects are served
 * only through routes that check agreement membership.
 */

export type StoredObject = { text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>; contentType: string | null };
export type EvidenceStore = {
  kind: "r2" | "d1";
  put(key: string, value: string | ArrayBuffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
};

/** D1 rows are capped near 2 MB; evidence snapshots are bounded well below this. */
export const D1_OBJECT_LIMIT = 1_900_000;

const toBytes = (value: string | ArrayBuffer | Uint8Array) =>
  typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);

function fromRow(body: unknown): Uint8Array {
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Uint8Array) return body;
  if (Array.isArray(body)) return Uint8Array.from(body as number[]);
  throw new Error("Stored evidence has an unexpected format");
}

export function evidenceStore(bindings: { BUCKET?: R2Bucket; DB?: D1Database }): EvidenceStore | null {
  const bucket = bindings.BUCKET;
  if (bucket) return {
    kind: "r2",
    async put(key, value, contentType) { await bucket.put(key, value, { httpMetadata: { contentType } }); },
    async get(key) {
      const object = await bucket.get(key);
      return object ? { text: () => object.text(), arrayBuffer: () => object.arrayBuffer(), contentType: object.httpMetadata?.contentType ?? null } : null;
    },
    async delete(key) { await bucket.delete(key); },
  };
  const db = bindings.DB;
  if (!db) return null;
  return {
    kind: "d1",
    async put(key, value, contentType) {
      const bytes = toBytes(value);
      if (bytes.byteLength > D1_OBJECT_LIMIT) throw new Error("Evidence object is too large for database storage; enable R2");
      await db.prepare("INSERT OR REPLACE INTO evidence_objects (key,content_type,body,size,created_at) VALUES (?,?,?,?,?)")
        .bind(key, contentType, bytes, bytes.byteLength, new Date().toISOString()).run();
    },
    async get(key) {
      const row = await db.prepare("SELECT content_type,body FROM evidence_objects WHERE key=?").bind(key).first<{ content_type: string; body: unknown }>();
      if (!row) return null;
      const bytes = fromRow(row.body);
      return {
        contentType: row.content_type,
        text: async () => new TextDecoder().decode(bytes),
        arrayBuffer: async () => bytes.slice().buffer,
      };
    },
    async delete(key) { await db.prepare("DELETE FROM evidence_objects WHERE key=?").bind(key).run(); },
  };
}
