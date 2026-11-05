import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  clientEmail: text("client_email").notNull(),
  freelancerEmail: text("freelancer_email").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  criteriaJson: text("criteria_json").notNull(),
  status: text("status").notNull().default("AGREED"),
  evidenceUrl: text("evidence_url"),
  evidenceNotes: text("evidence_notes"),
  evidenceHash: text("evidence_hash"),
  evidenceAt: text("evidence_at"),
  currentSubmissionId: text("current_submission_id"),
  findingsJson: text("findings_json"),
  evaluatedAt: text("evaluated_at"),
  decisionReason: text("decision_reason"),
  paypalOrderId: text("paypal_order_id").unique(),
  paypalCaptureId: text("paypal_capture_id").unique(),
  paymentStatus: text("payment_status").notNull().default("NOT_STARTED"),
  paymentRequestId: text("payment_request_id"),
  latestRunId: text("latest_run_id"),
  auditHeadHash: text("audit_head_hash"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  actor: text("actor").notNull(),
  type: text("type").notNull(),
  detail: text("detail").notNull(),
  previousHash: text("previous_hash"),
  eventHash: text("event_hash"),
  createdAt: text("created_at").notNull(),
});

export const paypalEvents = sqliteTable("paypal_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  eventType: text("event_type").notNull(),
  receivedAt: text("received_at").notNull(),
});

export const verificationRuns = sqliteTable("verification_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  checkerVersion: text("checker_version").notNull(),
  model: text("model"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  state: text("state").notNull(),
  websiteStatus: integer("website_status"),
  websiteBodyHash: text("website_body_hash"),
  websiteTruncated: integer("website_truncated"),
  findingsJson: text("findings_json"),
  aiNote: text("ai_note"),
  submissionId: text("submission_id"),
  snapshotHash: text("snapshot_hash"),
  coverageJson: text("coverage_json"),
});

export const evidenceSubmissions = sqliteTable("evidence_submissions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  submittedBy: text("submitted_by").notNull(),
  url: text("url").notNull(),
  notes: text("notes").notNull(),
  submissionHash: text("submission_hash").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  snapshotKey: text("snapshot_key").notNull().unique(),
  manifestJson: text("manifest_json").notNull(),
  createdAt: text("created_at").notNull(),
});
