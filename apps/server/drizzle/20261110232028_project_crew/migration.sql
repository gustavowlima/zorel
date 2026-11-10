ALTER TABLE `projects` ADD `agent_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `team_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `agent_ids` = json_array(`default_agent_id`) WHERE `default_agent_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `default_agent_id`;