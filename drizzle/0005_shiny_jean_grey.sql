CREATE TABLE `reconciliation_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`outcome` text NOT NULL,
	`detail` text NOT NULL,
	`attempted_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seller_onboarding` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`freelancer_email` text NOT NULL,
	`tracking_id` text NOT NULL,
	`referral_id` text,
	`merchant_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`verified_at` text,
	`last_checked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_onboarding_tracking_id_unique` ON `seller_onboarding` (`tracking_id`);--> statement-breakpoint
CREATE TABLE `verification_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`criteria_hash` text NOT NULL,
	`live_key` text NOT NULL,
	`live_hash` text NOT NULL,
	`objective_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_artifacts_run_id_unique` ON `verification_artifacts` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `verification_artifacts_live_key_unique` ON `verification_artifacts` (`live_key`);--> statement-breakpoint
ALTER TABLE `projects` ADD `seller_merchant_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `seller_verified_at` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `payment_recipient_merchant_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `payment_last_reconciled_at` text;
--> statement-breakpoint
CREATE INDEX `verification_artifacts_project_idx` ON `verification_artifacts` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `seller_onboarding_project_idx` ON `seller_onboarding` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `reconciliation_attempts_project_idx` ON `reconciliation_attempts` (`project_id`,`attempted_at`);
--> statement-breakpoint
CREATE INDEX `projects_reconciliation_idx` ON `projects` (`payment_status`,`payment_last_reconciled_at`);
--> statement-breakpoint
CREATE TRIGGER `verification_artifacts_no_update` BEFORE UPDATE ON `verification_artifacts`
BEGIN SELECT RAISE(ABORT, 'verification artifacts are append only'); END;
--> statement-breakpoint
CREATE TRIGGER `verification_artifacts_no_delete` BEFORE DELETE ON `verification_artifacts`
BEGIN SELECT RAISE(ABORT, 'verification artifacts are append only'); END;
--> statement-breakpoint
CREATE TRIGGER `reconciliation_attempts_no_update` BEFORE UPDATE ON `reconciliation_attempts`
BEGIN SELECT RAISE(ABORT, 'reconciliation attempts are append only'); END;
--> statement-breakpoint
CREATE TRIGGER `reconciliation_attempts_no_delete` BEFORE DELETE ON `reconciliation_attempts`
BEGIN SELECT RAISE(ABORT, 'reconciliation attempts are append only'); END;
