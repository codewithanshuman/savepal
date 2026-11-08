import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  paymentOrderRequestedAt: text("payment_order_requested_at"),
  paymentCaptureRequestId: text("payment_capture_request_id"),
  paymentCaptureRequestedAt: text("payment_capture_requested_at"),
  approvalReceiptId: text("approval_receipt_id"),
  sellerMerchantId: text("seller_merchant_id"),
  sellerVerifiedAt: text("seller_verified_at"),
  paymentRecipientMerchantId: text("payment_recipient_merchant_id"),
  paymentLastReconciledAt: text("payment_last_reconciled_at"),
  latestRunId: text("latest_run_id"),
  auditHeadHash: text("audit_head_hash"),
  maxRevisions: integer("max_revisions"),
  revisionCount: integer("revision_count").notNull().default(0),
  termsHash: text("terms_hash"),
  acceptedTermsHash: text("accepted_terms_hash"),
  acceptedAt: text("accepted_at"),
  // Fund first: CAPTURE = pay after approval; HOLD = PayPal authorization placed before work starts.
  fundingMode: text("funding_mode").notNull().default("CAPTURE"),
  fundingStatus: text("funding_status").notNull().default("NONE"),
  fundingCustomId: text("funding_custom_id"),
  paypalAuthorizationId: text("paypal_authorization_id").unique(),
  fundingAuthorizeRequestId: text("funding_authorize_request_id"),
  fundingHeldAt: text("funding_held_at"),
  fundingExpiresAt: text("funding_expires_at"),
  fundingRenewedAt: text("funding_renewed_at"),
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

export const approvalReceipts = sqliteTable("approval_receipts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  source: text("source").notNull(),
  agreementHash: text("agreement_hash").notNull(),
  submissionId: text("submission_id").notNull(),
  submissionHash: text("submission_hash").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  verificationRunId: text("verification_run_id").notNull(),
  findingsHash: text("findings_hash").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  approvedBy: text("approved_by").notNull(),
  reason: text("reason").notNull(),
  approvedAt: text("approved_at").notNull(),
  previousAuditHash: text("previous_audit_hash"),
  receiptHash: text("receipt_hash").notNull().unique(),
});

export const paymentObservations = sqliteTable("payment_observations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  source: text("source").notNull(),
  providerEventId: text("provider_event_id"),
  orderId: text("order_id").notNull(),
  captureId: text("capture_id").notNull(),
  providerStatus: text("provider_status").notNull(),
  projectedStatus: text("projected_status").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  payloadHash: text("payload_hash").notNull(),
  observedAt: text("observed_at").notNull(),
});

export const verificationArtifacts = sqliteTable("verification_artifacts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  runId: text("run_id").notNull().unique(),
  submissionId: text("submission_id").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  criteriaHash: text("criteria_hash").notNull(),
  liveKey: text("live_key").notNull().unique(),
  liveHash: text("live_hash").notNull(),
  objectiveHash: text("objective_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

export const sellerOnboarding = sqliteTable("seller_onboarding", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  freelancerEmail: text("freelancer_email").notNull(),
  trackingId: text("tracking_id").notNull().unique(),
  referralId: text("referral_id"),
  merchantId: text("merchant_id"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  verifiedAt: text("verified_at"),
  lastCheckedAt: text("last_checked_at"),
});

export const reconciliationAttempts = sqliteTable("reconciliation_attempts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  source: text("source").notNull(),
  outcome: text("outcome").notNull(),
  detail: text("detail").notNull(),
  attemptedAt: text("attempted_at").notNull(),
});

/** Database fallback for private evidence when no R2 bucket is bound. */
export const evidenceObjects = sqliteTable("evidence_objects", {
  key: text("key").primaryKey(),
  contentType: text("content_type").notNull(),
  body: blob("body").notNull(),
  size: integer("size").notNull(),
  createdAt: text("created_at").notNull(),
});

/** An AI inspector crew run over one submission. Advisory only: it never approves or pays. */
export const crewRuns = sqliteTable("crew_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  submissionId: text("submission_id").notNull(),
  status: text("status").notNull(),
  model: text("model").notNull(),
  steps: integer("steps").notNull().default(0),
  pagesRead: integer("pages_read").notNull().default(0),
  messagesJson: text("messages_json").notNull(),
  reportJson: text("report_json"),
  stepLockUntil: text("step_lock_until"),
  startedBy: text("started_by").notNull(),
  startedAt: text("started_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
});

/** What the crew did, in order: the live log the realm animates from. */
export const crewEvents = sqliteTable("crew_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  projectId: text("project_id").notNull(),
  kind: text("kind").notNull(),
  pageUrl: text("page_url"),
  criterionIndex: integer("criterion_index"),
  verdict: text("verdict"),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull(),
});

/** A bonus the client pays the freelancer on top of the agreement: its own PayPal checkout (capture). */
export const bounties = sqliteTable("bounties", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  note: text("note").notNull(),
  createdBy: text("created_by").notNull(),
  paypalOrderId: text("paypal_order_id"),
  paypalCaptureId: text("paypal_capture_id"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** A client's appeal after payment; the freelancer grants it with a real PayPal refund, or answers it. */
export const appeals = sqliteTable("appeals", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  filedBy: text("filed_by").notNull(),
  status: text("status").notNull(),
  reply: text("reply"),
  paypalRefundId: text("paypal_refund_id"),
  refundStatus: text("refund_status"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});
