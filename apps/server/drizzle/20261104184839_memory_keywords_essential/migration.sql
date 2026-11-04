ALTER TABLE `memories` ADD `keywords` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD `essential` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Search covers the keywords too (other words for the same idea), so a question in different words still finds it.
DROP TRIGGER IF EXISTS `memories_ai`;
--> statement-breakpoint
CREATE TRIGGER `memories_ai` AFTER INSERT ON `memories` BEGIN
  INSERT INTO memory_index (id, body) VALUES (new.id, new.title || ' ' || new.text || ' ' || new.keywords);
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `memories_au`;
--> statement-breakpoint
CREATE TRIGGER `memories_au` AFTER UPDATE OF title, text, keywords ON `memories` BEGIN
  UPDATE memory_index SET body = new.title || ' ' || new.text || ' ' || new.keywords WHERE id = new.id;
END;
