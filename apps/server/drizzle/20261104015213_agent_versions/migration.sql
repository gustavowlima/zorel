CREATE TABLE `agent_versions` (
	`id` text PRIMARY KEY,
	`agent_id` text NOT NULL,
	`n` integer NOT NULL,
	`profile` text NOT NULL,
	`by` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `fk_agent_versions_agent_id_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE CASCADE
);
