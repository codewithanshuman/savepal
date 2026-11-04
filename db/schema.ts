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
  findingsJson: text("findings_json"),
  evaluatedAt: text("evaluated_at"),
  decisionReason: text("decision_reason"),
  paypalOrderId: text("paypal_order_id"),
  paypalCaptureId: text("paypal_capture_id"),
  paymentStatus: text("payment_status").notNull().default("NOT_STARTED"),
  paymentRequestId: text("payment_request_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull(),
  actor: text("actor").notNull(),
  type: text("type").notNull(),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull(),
});

export const paypalEvents = sqliteTable("paypal_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  eventType: text("event_type").notNull(),
  receivedAt: text("received_at").notNull(),
});
