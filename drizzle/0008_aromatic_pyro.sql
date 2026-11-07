CREATE TABLE `crew_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`page_url` text,
	`criterion_index` integer,
	`verdict` text,
	`text` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `crew_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`steps` integer DEFAULT 0 NOT NULL,
	`pages_read` integer DEFAULT 0 NOT NULL,
	`messages_json` text NOT NULL,
	`report_json` text,
	`step_lock_until` text,
	`started_by` text NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `evidence_objects` (
	`key` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`body` blob NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL
);
