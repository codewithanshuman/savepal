CREATE TABLE `verification_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`checker_version` text NOT NULL,
	`model` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`state` text NOT NULL,
	`website_status` integer,
	`website_body_hash` text,
	`website_truncated` integer,
	`findings_json` text,
	`ai_note` text
);
--> statement-breakpoint
ALTER TABLE `audit_events` ADD `previous_hash` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `event_hash` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `latest_run_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `audit_head_hash` text;
--> statement-breakpoint
CREATE TRIGGER `audit_chain_insert` BEFORE INSERT ON `audit_events`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id) THEN RAISE(ABORT, 'audit project missing') END;
  SELECT CASE WHEN NEW.event_hash IS NULL THEN RAISE(ABORT, 'audit hash missing') END;
  SELECT CASE WHEN (SELECT audit_head_hash FROM projects WHERE id = NEW.project_id) IS NOT NEW.previous_hash THEN RAISE(ABORT, 'audit chain mismatch') END;
  UPDATE projects SET audit_head_hash = NEW.event_hash WHERE id = NEW.project_id;
END;
--> statement-breakpoint
CREATE TRIGGER `audit_chain_update` BEFORE UPDATE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'audit events are append only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_chain_delete` BEFORE DELETE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'audit events are append only');
END;
