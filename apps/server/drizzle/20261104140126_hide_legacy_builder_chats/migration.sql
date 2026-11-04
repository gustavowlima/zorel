-- Chats with the Builder (Zorel's own agent) belong to the Build with AI screen, not the chats list. Older versions
-- created them visible ("Build agents"); hide them, and the screen clears them on its next visit.
UPDATE `chats` SET `hidden` = 1 WHERE `id` IN (SELECT `m`.`chat_id` FROM `chat_members` `m` JOIN `agents` `a` ON `a`.`id` = `m`.`agent_id` WHERE `a`.`builtin` = 'builder');
