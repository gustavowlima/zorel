ALTER TABLE `memories` ADD `owner` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD `audience` text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE `turns` ADD `first_token_at` integer;--> statement-breakpoint
-- Memórias sobre a pessoa (escopo user) só o dono ouve.
UPDATE `memories` SET `audience` = 'owner' WHERE `scope` = 'user';
