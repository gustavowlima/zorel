-- Search over knowledge pages (title + body), kept in step by triggers, like memory_index.
CREATE VIRTUAL TABLE page_index USING fts5(id UNINDEXED, body, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO page_index (id, body) VALUES (new.id, new.title || ' ' || new.body);
END;
--> statement-breakpoint
CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
  DELETE FROM page_index WHERE id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER pages_au AFTER UPDATE OF title, body ON pages BEGIN
  UPDATE page_index SET body = new.title || ' ' || new.body WHERE id = new.id;
END;
