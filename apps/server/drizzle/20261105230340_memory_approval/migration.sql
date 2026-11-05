-- One approval setting replaces the per-agent "auto" / "ask" (2026-11-05). If every agent that learns already saved
-- facts on its own, keep that ("undo"); otherwise new facts wait for review (the default, no row). Agents keep only
-- whether they learn: "auto" becomes "ask"; "read" stays.
INSERT OR IGNORE INTO `preferences` (`key`, `value`)
  SELECT 'memoryApproval', 'undo'
  WHERE EXISTS (SELECT 1 FROM `agents` WHERE `memory` = 'auto')
    AND NOT EXISTS (SELECT 1 FROM `agents` WHERE `memory` = 'ask');--> statement-breakpoint
UPDATE `agents` SET `memory` = 'ask' WHERE `memory` = 'auto';
