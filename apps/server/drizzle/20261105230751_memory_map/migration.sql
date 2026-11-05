CREATE TABLE `entities` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`normalized` text NOT NULL,
	`type` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer NOT NULL,
	CONSTRAINT `entities_scope_normalized` UNIQUE(`scope`,`normalized`)
);
--> statement-breakpoint
CREATE TABLE `entity_links` (
	`a` text NOT NULL,
	`b` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `entity_links_pk` PRIMARY KEY(`a`, `b`),
	CONSTRAINT `fk_entity_links_a_entities_id_fk` FOREIGN KEY (`a`) REFERENCES `entities`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_entity_links_b_entities_id_fk` FOREIGN KEY (`b`) REFERENCES `entities`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `memory_entities` (
	`memory_id` text NOT NULL,
	`entity_id` text NOT NULL,
	CONSTRAINT `memory_entities_pk` PRIMARY KEY(`memory_id`, `entity_id`),
	CONSTRAINT `fk_memory_entities_memory_id_memories_id_fk` FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_memory_entities_entity_id_entities_id_fk` FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `relations` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`src` text NOT NULL,
	`dst` text NOT NULL,
	`rel` text NOT NULL,
	`memory_id` text,
	`created_at` integer NOT NULL,
	`invalid_at` integer,
	CONSTRAINT `fk_relations_src_entities_id_fk` FOREIGN KEY (`src`) REFERENCES `entities`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_relations_dst_entities_id_fk` FOREIGN KEY (`dst`) REFERENCES `entities`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_relations_memory_id_memories_id_fk` FOREIGN KEY (`memory_id`) REFERENCES `memories`(`id`) ON DELETE SET NULL,
	CONSTRAINT `relations_src_dst_rel` UNIQUE(`src`,`dst`,`rel`)
);
--> statement-breakpoint
CREATE INDEX `memory_entities_entity` ON `memory_entities` (`entity_id`);--> statement-breakpoint
CREATE INDEX `relations_dst` ON `relations` (`dst`);