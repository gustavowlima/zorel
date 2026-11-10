CREATE TABLE `routine_run_steps` (
	`id` text PRIMARY KEY,
	`run_id` text NOT NULL,
	`node_id` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`state` text NOT NULL,
	`branch` text,
	`input` text DEFAULT '' NOT NULL,
	`output` text DEFAULT '' NOT NULL,
	`output_file` text,
	`may_have_written` integer DEFAULT false NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	CONSTRAINT `fk_routine_run_steps_run_id_routine_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `routine_runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `routine_versions` (
	`routine_id` text NOT NULL,
	`n` integer NOT NULL,
	`graph` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `routine_versions_pk` PRIMARY KEY(`routine_id`, `n`),
	CONSTRAINT `fk_routine_versions_routine_id_routines_id_fk` FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `approvals` ADD `run_step_id` text REFERENCES routine_run_steps(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `routine_runs` ADD `version` integer;--> statement-breakpoint
ALTER TABLE `routines` ADD `version` integer;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_approvals` (
	`id` text PRIMARY KEY,
	`chat_id` text NOT NULL,
	`turn_id` text,
	`run_step_id` text,
	`step_id` text,
	`agent_id` text,
	`kind` text NOT NULL,
	`tool` text NOT NULL,
	`summary` text NOT NULL,
	`args` text NOT NULL,
	`cwd` text,
	`always_key` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`outcome` text,
	`reason` text,
	`decided_by` text,
	`decided_at` integer,
	CONSTRAINT `fk_approvals_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_approvals_turn_id_turns_id_fk` FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_approvals_run_step_id_routine_run_steps_id_fk` FOREIGN KEY (`run_step_id`) REFERENCES `routine_run_steps`(`id`) ON DELETE CASCADE,
	CONSTRAINT "approvals_anchor" CHECK(("turn_id" IS NULL) <> ("run_step_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_approvals`(`id`, `chat_id`, `turn_id`, `step_id`, `agent_id`, `kind`, `tool`, `summary`, `args`, `cwd`, `always_key`, `created_at`, `expires_at`, `outcome`, `reason`, `decided_by`, `decided_at`) SELECT `id`, `chat_id`, `turn_id`, `step_id`, `agent_id`, `kind`, `tool`, `summary`, `args`, `cwd`, `always_key`, `created_at`, `expires_at`, `outcome`, `reason`, `decided_by`, `decided_at` FROM `approvals`;--> statement-breakpoint
DROP TABLE `approvals`;--> statement-breakpoint
ALTER TABLE `__new_approvals` RENAME TO `approvals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `approvals_open` ON `approvals` (`outcome`,`chat_id`);--> statement-breakpoint
CREATE INDEX `routine_run_steps_by_run` ON `routine_run_steps` (`run_id`,`started_at`);