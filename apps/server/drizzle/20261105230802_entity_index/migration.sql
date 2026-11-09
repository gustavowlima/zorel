-- Entity names and aliases, indexed by trigrams: finds "Vercel" in "vercel.com" or "Versel", and the entities a
-- message mentions (recall). Kept by triggers, like memory_index and page_index.
CREATE VIRTUAL TABLE `entity_index` USING fts5(`id` UNINDEXED, `body`, tokenize = 'trigram remove_diacritics 1');--> statement-breakpoint
CREATE TRIGGER `entities_ai` AFTER INSERT ON `entities` BEGIN
  INSERT INTO `entity_index` (`id`, `body`) VALUES (new.`id`, new.`name` || ' ' || (SELECT coalesce(group_concat(value, ' '), '') FROM json_each(new.`aliases`)));
END;--> statement-breakpoint
CREATE TRIGGER `entities_ad` AFTER DELETE ON `entities` BEGIN
  DELETE FROM `entity_index` WHERE `id` = old.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `entities_au` AFTER UPDATE OF `name`, `aliases` ON `entities` BEGIN
  DELETE FROM `entity_index` WHERE `id` = old.`id`;
  INSERT INTO `entity_index` (`id`, `body`) VALUES (new.`id`, new.`name` || ' ' || (SELECT coalesce(group_concat(value, ' '), '') FROM json_each(new.`aliases`)));
END;
