CREATE TABLE `evidence_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`submitted_by` text NOT NULL,
	`url` text NOT NULL,
	`notes` text NOT NULL,
	`submission_hash` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`snapshot_key` text NOT NULL,
	`manifest_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_submissions_snapshot_key_unique` ON `evidence_submissions` (`snapshot_key`);--> statement-breakpoint
ALTER TABLE `projects` ADD `current_submission_id` text;--> statement-breakpoint
ALTER TABLE `verification_runs` ADD `submission_id` text;--> statement-breakpoint
ALTER TABLE `verification_runs` ADD `snapshot_hash` text;--> statement-breakpoint
ALTER TABLE `verification_runs` ADD `coverage_json` text;
--> statement-breakpoint
CREATE TRIGGER `evidence_submissions_no_update` BEFORE UPDATE ON `evidence_submissions`
BEGIN
  SELECT RAISE(ABORT, 'evidence submissions are append only');
END;
--> statement-breakpoint
CREATE TRIGGER `evidence_submissions_no_delete` BEFORE DELETE ON `evidence_submissions`
BEGIN
  SELECT RAISE(ABORT, 'evidence submissions are append only');
END;
