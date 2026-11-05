-- Pages access got a "write" level (2026-11-05). An agent that could write pages before (it read them and its
-- memory mode wasn't "read") keeps that ability.
UPDATE `agents` SET `knowledge` = 'write' WHERE `knowledge` = 'read' AND `memory` <> 'read';
