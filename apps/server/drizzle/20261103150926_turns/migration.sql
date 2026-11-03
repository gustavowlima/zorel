CREATE TABLE `approvals` (
	`id` text PRIMARY KEY,
	`chat_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`step_id` text,
	`agent_id` text,
	`kind` text NOT NULL,
	`tool` text NOT NULL,
	`summary` text NOT NULL,
	`args` text NOT NULL,
	`cwd` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`outcome` text,
	`reason` text,
	`decided_by` text,
	`decided_at` integer,
	CONSTRAINT `fk_approvals_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_approvals_turn_id_turns_id_fk` FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `steps` (
	`id` text PRIMARY KEY,
	`turn_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`tool` text,
	`files` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer,
	`changes` text DEFAULT '[]' NOT NULL,
	`output` text DEFAULT '' NOT NULL,
	CONSTRAINT `fk_steps_turn_id_turns_id_fk` FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY,
	`chat_id` text NOT NULL,
	`agent_id` text,
	`model` text NOT NULL,
	`account_id` text,
	`client_id` text UNIQUE,
	`state` text NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`error` text,
	`partial_text` text DEFAULT '' NOT NULL,
	`message_id` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_turns_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `approvals_open` ON `approvals` (`outcome`,`chat_id`);--> statement-breakpoint
CREATE INDEX `steps_by_turn` ON `steps` (`turn_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `turns_by_chat` ON `turns` (`chat_id`,`state`,`created_at`);