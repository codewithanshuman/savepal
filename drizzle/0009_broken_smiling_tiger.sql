CREATE TABLE `appeals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`filed_by` text NOT NULL,
	`status` text NOT NULL,
	`reply` text,
	`paypal_refund_id` text,
	`refund_status` text,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE TABLE `bounties` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`note` text NOT NULL,
	`created_by` text NOT NULL,
	`paypal_order_id` text,
	`paypal_capture_id` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `funding_renewed_at` text;