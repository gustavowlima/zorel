CREATE TABLE `devices` (
	`id` text PRIMARY KEY,
	`person_id` text NOT NULL,
	`name` text NOT NULL,
	`public_key` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `pairing_codes` (
	`hash` text PRIMARY KEY,
	`person_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `devices_person` ON `devices` (`person_id`);