ALTER TABLE `chats` ADD `task_of` text REFERENCES chats(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `task_by` text;