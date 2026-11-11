CREATE TABLE `project_members` (
	`project_id` text NOT NULL,
	`person_id` text NOT NULL,
	`added_at` integer NOT NULL,
	CONSTRAINT `project_members_pk` PRIMARY KEY(`project_id`, `person_id`),
	CONSTRAINT `fk_project_members_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `turns` ADD `person_id` text;--> statement-breakpoint
CREATE INDEX `project_members_person` ON `project_members` (`person_id`);