-- Message text, indexed for recall: a turn finds what was said in other chats of its project (spec 002). Kept by
-- triggers like memory_index; messages are inserted once and only deleted (with their chat).
CREATE VIRTUAL TABLE `message_index` USING fts5(`id` UNINDEXED, `body`, tokenize = 'unicode61 remove_diacritics 2');--> statement-breakpoint
CREATE TRIGGER `messages_ai` AFTER INSERT ON `messages` BEGIN
  INSERT INTO `message_index` (`id`, `body`) VALUES (new.`id`, new.`text`);
END;--> statement-breakpoint
CREATE TRIGGER `messages_ad` AFTER DELETE ON `messages` BEGIN
  DELETE FROM `message_index` WHERE `id` = old.`id`;
END;--> statement-breakpoint
INSERT INTO `message_index` (`id`, `body`) SELECT `id`, `text` FROM `messages`;
