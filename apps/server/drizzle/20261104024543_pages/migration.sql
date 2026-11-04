CREATE TABLE `page_versions` (
	`id` text PRIMARY KEY,
	`page_id` text NOT NULL,
	`n` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`by` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `fk_page_versions_page_id_pages_id_fk` FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
