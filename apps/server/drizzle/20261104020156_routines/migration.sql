CREATE TABLE `routines` (
	`id` text PRIMARY KEY,
	`agent_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`cron` text,
	`token` text UNIQUE,
	`enabled` integer DEFAULT true NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_status` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_routines_agent_id_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_routines_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE
);
