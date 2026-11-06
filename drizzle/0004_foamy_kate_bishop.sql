CREATE TABLE `approval_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`agreement_hash` text NOT NULL,
	`submission_id` text NOT NULL,
	`submission_hash` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`verification_run_id` text NOT NULL,
	`findings_hash` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`approved_by` text NOT NULL,
	`reason` text NOT NULL,
	`approved_at` text NOT NULL,
	`previous_audit_hash` text,
	`receipt_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_receipts_receipt_hash_unique` ON `approval_receipts` (`receipt_hash`);--> statement-breakpoint
CREATE TABLE `payment_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`provider_event_id` text,
	`order_id` text NOT NULL,
	`capture_id` text NOT NULL,
	`provider_status` text NOT NULL,
	`projected_status` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`payload_hash` text NOT NULL,
	`observed_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `payment_order_requested_at` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `payment_capture_request_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `payment_capture_requested_at` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `approval_receipt_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_receipts_project_unique` ON `approval_receipts` (`project_id`);
--> statement-breakpoint
CREATE INDEX `payment_observations_project_idx` ON `payment_observations` (`project_id`, `observed_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_observations_provider_event_unique` ON `payment_observations` (`provider_event_id`);
--> statement-breakpoint
CREATE TRIGGER `approval_receipts_no_update` BEFORE UPDATE ON `approval_receipts`
BEGIN
  SELECT RAISE(ABORT, 'approval receipts are append only');
END;
--> statement-breakpoint
CREATE TRIGGER `approval_receipts_no_delete` BEFORE DELETE ON `approval_receipts`
BEGIN
  SELECT RAISE(ABORT, 'approval receipts are append only');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_observations_no_update` BEFORE UPDATE ON `payment_observations`
BEGIN
  SELECT RAISE(ABORT, 'payment observations are append only');
END;
--> statement-breakpoint
CREATE TRIGGER `payment_observations_no_delete` BEFORE DELETE ON `payment_observations`
BEGIN
  SELECT RAISE(ABORT, 'payment observations are append only');
END;
