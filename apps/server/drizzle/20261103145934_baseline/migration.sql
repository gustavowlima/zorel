-- Linha de base: o banco do MVP já tem estas tabelas (criadas por SQL à mão, PRAGMA user_version 3).
-- Tudo aqui usa IF NOT EXISTS para o mesmo arquivo servir a um banco novo e a um existente, sem cópia.
-- Editado à mão depois do drizzle-kit: IF NOT EXISTS e o índice de busca (FTS5 + gatilhos), que o Drizzle não modela.
CREATE TABLE IF NOT EXISTS `agents` (
	`id` text PRIMARY KEY,
	`project_id` text,
	`name` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_agents_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_members` (
	`chat_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `chat_members_pk` PRIMARY KEY(`chat_id`, `agent_id`),
	CONSTRAINT `fk_chat_members_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_chat_members_agent_id_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chats` (
	`id` text PRIMARY KEY,
	`project_id` text,
	`title` text NOT NULL,
	`model` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`summary_until` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_chats_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mcp_servers` (
	`id` text PRIMARY KEY,
	`project_id` text,
	`name` text NOT NULL,
	`command` text DEFAULT '' NOT NULL,
	`args` text DEFAULT '[]' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`env_keys` text DEFAULT '[]' NOT NULL,
	`mode` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_mcp_servers_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memories` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`kind` text DEFAULT 'fact' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`text` text NOT NULL,
	`normalized` text NOT NULL,
	`state` text NOT NULL,
	`origin` text NOT NULL,
	`chat_id` text,
	`created_at` integer NOT NULL,
	`confirmed_at` integer NOT NULL,
	CONSTRAINT `memories_scope_normalized` UNIQUE(`scope`,`normalized`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
	`id` text PRIMARY KEY,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`agent_id` text,
	`text` text NOT NULL,
	`model` text,
	`error` text,
	`steps` text DEFAULT '[]' NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT `fk_messages_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE,
	CONSTRAINT "messages_role" CHECK("role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `projects` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`brief` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_by_chat` ON `messages` (`chat_id`,`at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `memory_index` USING fts5(id UNINDEXED, body, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `memories_ai` AFTER INSERT ON `memories` BEGIN
  INSERT INTO memory_index (id, body) VALUES (new.id, new.title || ' ' || new.text);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `memories_ad` AFTER DELETE ON `memories` BEGIN
  DELETE FROM memory_index WHERE id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `memories_au` AFTER UPDATE OF title, text ON `memories` BEGIN
  UPDATE memory_index SET body = new.title || ' ' || new.text WHERE id = new.id;
END;
