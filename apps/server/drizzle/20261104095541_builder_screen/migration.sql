ALTER TABLE `agents` ADD `builtin` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `agents` SET `builtin` = 'builder' WHERE `project_id` IS NULL AND `title` = 'Designs agents and teams';--> statement-breakpoint
UPDATE `chats` SET `hidden` = 1 WHERE `title` = 'Build agents' AND `id` IN (SELECT `chat_id` FROM `chat_members` WHERE `agent_id` IN (SELECT `id` FROM `agents` WHERE `builtin` = 'builder'));
