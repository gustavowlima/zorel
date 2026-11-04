CREATE TABLE `memory_versions` (
	`id` text PRIMARY KEY,
	`memory_id` text NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`by` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `fk_memory_versions_memory_id_memories_id_fk` FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `memories` ADD `replaces` text;--> statement-breakpoint
ALTER TABLE `memories` ADD `reason` text;