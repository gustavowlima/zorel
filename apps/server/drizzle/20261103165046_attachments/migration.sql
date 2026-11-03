CREATE TABLE `attachments` (
	`id` text PRIMARY KEY,
	`chat_id` text NOT NULL,
	`message_id` text,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_attachments_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `attachments_by_message` ON `attachments` (`message_id`);