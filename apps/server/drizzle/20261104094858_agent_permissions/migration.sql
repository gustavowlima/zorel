ALTER TABLE `agents` ADD `permissions` text DEFAULT '{"web":true,"browser":true,"grants":{},"always":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `approvals` ADD `always_key` text;