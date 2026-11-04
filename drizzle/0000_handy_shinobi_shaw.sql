CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`actor` text NOT NULL,
	`type` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paypal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`event_type` text NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_email` text NOT NULL,
	`freelancer_email` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`criteria_json` text NOT NULL,
	`status` text DEFAULT 'AGREED' NOT NULL,
	`evidence_url` text,
	`evidence_notes` text,
	`evidence_hash` text,
	`evidence_at` text,
	`findings_json` text,
	`evaluated_at` text,
	`decision_reason` text,
	`paypal_order_id` text,
	`paypal_capture_id` text,
	`payment_status` text DEFAULT 'NOT_STARTED' NOT NULL,
	`payment_request_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
