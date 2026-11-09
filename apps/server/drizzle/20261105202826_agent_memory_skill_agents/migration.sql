ALTER TABLE `agents` ADD `memory` text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `knowledge` text DEFAULT 'read' NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD `agents` text DEFAULT '[]' NOT NULL;