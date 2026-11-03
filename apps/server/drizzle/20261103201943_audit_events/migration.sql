CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY,
	`at` integer NOT NULL,
	`action` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`target_name` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text,
	`changes` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_at` ON `audit_events` (`at`);