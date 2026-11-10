CREATE TABLE `routine_runs` (
	`id` text PRIMARY KEY,
	`routine_id` text NOT NULL,
	`trigger` text NOT NULL,
	`payload` text,
	`label` text,
	`state` text NOT NULL,
	`outcome` text,
	`summary` text DEFAULT '' NOT NULL,
	`report` text DEFAULT '' NOT NULL,
	`turn_id` text,
	`message_id` text,
	`triage_tokens` integer DEFAULT 0 NOT NULL,
	`cost` real,
	`held` integer DEFAULT false NOT NULL,
	`delivered_at` integer,
	`delivery_note` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	CONSTRAINT `fk_routine_runs_routine_id_routines_id_fk` FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `routines` ADD `on_day_start` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `routines` ADD `day_ran_on` text;--> statement-breakpoint
ALTER TABLE `routines` ADD `look_first` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `routines` ADD `delivery` text DEFAULT '{"channels":["notify"]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `routines` ADD `tell` text DEFAULT 'something' NOT NULL;--> statement-breakpoint
ALTER TABLE `routines` ADD `urgent` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `routine_runs_queue` ON `routine_runs` (`routine_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `routine_runs_by_time` ON `routine_runs` (`created_at`);