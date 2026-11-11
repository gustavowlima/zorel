CREATE TABLE `agent_team_members` (
	`team_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `agent_team_members_pk` PRIMARY KEY(`team_id`, `agent_id`),
	CONSTRAINT `fk_agent_team_members_team_id_agent_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `agent_teams`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_agent_team_members_agent_id_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `agent_teams` (
	`id` text PRIMARY KEY,
	`project_id` text,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_agent_teams_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `turns` ADD `route_team_id` text;