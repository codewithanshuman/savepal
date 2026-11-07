ALTER TABLE `projects` ADD `funding_mode` text DEFAULT 'CAPTURE' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `funding_status` text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `funding_custom_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `paypal_authorization_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `funding_authorize_request_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `funding_held_at` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `funding_expires_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_paypal_authorization_id_unique` ON `projects` (`paypal_authorization_id`);