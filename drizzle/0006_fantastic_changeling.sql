ALTER TABLE `projects` ADD `max_revisions` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `revision_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `terms_hash` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `accepted_terms_hash` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `accepted_at` text;