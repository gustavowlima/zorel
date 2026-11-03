CREATE TABLE `preferences` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `failover` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `chats` ADD `failover` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `switches` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_accounts` ADD `limited_until` integer;--> statement-breakpoint
ALTER TABLE `provider_accounts` ADD `usage` text;--> statement-breakpoint
ALTER TABLE `turns` ADD `switches` text DEFAULT '[]' NOT NULL;