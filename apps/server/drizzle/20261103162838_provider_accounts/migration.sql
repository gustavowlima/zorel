CREATE TABLE `provider_accounts` (
	`id` text PRIMARY KEY,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`home` text,
	`secret` text,
	`base_url` text,
	`identity` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `account_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `account_id` text;