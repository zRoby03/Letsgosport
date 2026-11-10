CREATE TABLE IF NOT EXISTS private_conversations (
    first_user_id INT NOT NULL,
    second_user_id INT NOT NULL,
    PRIMARY KEY (first_user_id, second_user_id),
    KEY idx_private_conversations_second (second_user_id),
    CONSTRAINT fk_private_conversations_first FOREIGN KEY (first_user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_private_conversations_second FOREIGN KEY (second_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO private_conversations (first_user_id, second_user_id)
SELECT DISTINCT first_user.id, second_user.id
FROM messages m
JOIN users first_user ON first_user.id = CASE
    WHEN m.room REGEXP '^private_[1-9][0-9]{0,9}_[1-9][0-9]{0,9}$'
    THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(m.room, '_', 2), '_', -1) AS UNSIGNED) END
JOIN users second_user ON second_user.id = CASE
    WHEN m.room REGEXP '^private_[1-9][0-9]{0,9}_[1-9][0-9]{0,9}$'
    THEN CAST(SUBSTRING_INDEX(m.room, '_', -1) AS UNSIGNED) END
WHERE m.room REGEXP '^private_[1-9][0-9]{0,9}_[1-9][0-9]{0,9}$'
    AND first_user.id < second_user.id;

INSERT IGNORE INTO schema_migrations (name) VALUES ('003_private_conversations');
