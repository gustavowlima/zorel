ALTER TABLE `routines` ADD `schedule` text;--> statement-breakpoint
ALTER TABLE `routines` ADD `watch_every` integer DEFAULT 5 NOT NULL;