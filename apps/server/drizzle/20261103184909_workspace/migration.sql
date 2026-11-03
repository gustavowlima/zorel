ALTER TABLE `agents` ADD `access` text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `turn_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `changes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `reverted_at` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `path` text;--> statement-breakpoint
ALTER TABLE `turns` ADD `tree_before` text;--> statement-breakpoint
ALTER TABLE `turns` ADD `tree_after` text;