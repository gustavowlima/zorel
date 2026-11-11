ALTER TABLE `chats` ADD `parent_id` text REFERENCES chats(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `chats` SET `parent_id` = `task_of` WHERE `task_of` IS NOT NULL;--> statement-breakpoint
UPDATE `chats` SET `parent_id` = (SELECT m.`chat_id` FROM `messages` m WHERE m.`chat_id` <> `chats`.`id` AND m.`text` LIKE '%#/chat/' || `chats`.`id` || '%' ORDER BY m.`at` LIMIT 1) WHERE `parent_id` IS NULL AND `task_by` IS NOT NULL;
