type AuditRow = {
  id: number; actor: string; type: string; detail: string; created_at: string;
  previous_hash: string | null; event_hash: string | null;
};

async function digest(value: string, secret?: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const raw = secret
    ? await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), bytes)
    : await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(raw), b => b.toString(16).padStart(2, "0")).join("");
}

export async function appendAudit(
  db: D1Database, projectId: string, actor: string, type: string, detail: string,
  secret?: string,
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const project = await db.prepare("SELECT audit_head_hash FROM projects WHERE id=?").bind(projectId).first<{ audit_head_hash: string | null }>();
    if (!project) throw new Error("Project missing while appending audit event");
    const previous = project.audit_head_hash;
    const time = new Date().toISOString();
    const hash = await digest(JSON.stringify([previous, projectId, actor, type, detail, time]), secret);
    try {
      await db.prepare("INSERT INTO audit_events (project_id,actor,type,detail,previous_hash,event_hash,created_at) VALUES (?,?,?,?,?,?,?)")
        .bind(projectId,actor,type,detail,previous,hash,time).run();
      return;
    } catch (error) {
      const current = await db.prepare("SELECT audit_head_hash FROM projects WHERE id=?").bind(projectId).first<{ audit_head_hash: string | null }>();
      if (current?.audit_head_hash === previous || attempt === 3) throw error;
    }
  }
}

export async function verifyAudit(db: D1Database, projectId: string, secret?: string) {
  const project = await db.prepare("SELECT audit_head_hash FROM projects WHERE id=?").bind(projectId).first<{ audit_head_hash: string | null }>();
  if (!project) return { valid: false, checked: 0, legacy: 0 };
  const rows = await db.prepare("SELECT id,actor,type,detail,created_at,previous_hash,event_hash FROM audit_events WHERE project_id=? ORDER BY id ASC").bind(projectId).all<AuditRow>();
  let previous: string | null = null, checked = 0, legacy = 0;
  for (const row of rows.results) {
    if (!row.event_hash) { legacy++; continue; }
    if (row.previous_hash !== previous) return { valid: false, checked, legacy };
    const expected = await digest(JSON.stringify([previous, projectId, row.actor, row.type, row.detail, row.created_at]), secret);
    if (row.event_hash !== expected) return { valid: false, checked, legacy };
    previous = row.event_hash;
    checked++;
  }
  return { valid: previous === project.audit_head_hash, checked, legacy };
}
