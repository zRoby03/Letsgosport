USE `letsgosport`;

-- Migrazione non distruttiva per il database reale XAMPP.
-- Prima di eseguirla: fare sempre export/backup da phpMyAdmin.

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `executed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_schema_migrations_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

DELIMITER $$

CREATE PROCEDURE `lgs_add_column_if_missing`(
  IN table_name_in varchar(64),
  IN column_name_in varchar(64),
  IN ddl_in text
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_in
      AND COLUMN_NAME = column_name_in
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', table_name_in, '` ADD COLUMN ', ddl_in);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE `lgs_add_index_if_missing`(
  IN table_name_in varchar(64),
  IN index_name_in varchar(64),
  IN ddl_in text
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_in
      AND INDEX_NAME = index_name_in
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', table_name_in, '` ADD ', ddl_in);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE `lgs_modify_column_if_exists`(
  IN table_name_in varchar(64),
  IN column_name_in varchar(64),
  IN ddl_in text
)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_in
      AND COLUMN_NAME = column_name_in
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', table_name_in, '` MODIFY COLUMN ', ddl_in);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

DELIMITER ;

-- Colonne utili per audit futuro. Il codice attuale non dipende da queste colonne.
CALL lgs_add_column_if_missing('users', 'aggiornato_il', '`aggiornato_il` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()');
CALL lgs_add_column_if_missing('corsi', 'aggiornato_il', '`aggiornato_il` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()');
CALL lgs_add_column_if_missing('gare', 'aggiornato_il', '`aggiornato_il` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()');

-- Spazio MIME piu ampio per file audio/browser diversi.
CALL lgs_modify_column_if_exists('messages', 'file_type', '`file_type` varchar(100) DEFAULT NULL');

-- Indici utili per viste e filtri frequenti.
CALL lgs_add_index_if_missing('users', 'idx_users_ruolo', 'KEY `idx_users_ruolo` (`ruolo`)');
CALL lgs_add_index_if_missing('gare', 'idx_gare_giorno_orario', 'KEY `idx_gare_giorno_orario` (`giorno`, `orario`)');
CALL lgs_add_index_if_missing('corsi', 'idx_corsi_giorno_orario', 'KEY `idx_corsi_giorno_orario` (`giorno`, `orario_inizio`)');
CALL lgs_add_index_if_missing('messages', 'idx_messages_data_invio', 'KEY `idx_messages_data_invio` (`data_invio`)');

-- Default coerenti con gli asset del progetto.
CALL lgs_modify_column_if_exists('users', 'propic', '`propic` varchar(255) DEFAULT ''default_user.png''');
CALL lgs_modify_column_if_exists('corsi', 'propic', '`propic` varchar(255) DEFAULT ''default_corso.png''');
CALL lgs_modify_column_if_exists('gare', 'propic', '`propic` varchar(255) DEFAULT ''default_gara.png''');

-- Fix di emergenza: Assicuriamoci che l'ID dei messaggi si autoincrementi sempre!
CALL lgs_modify_column_if_exists('messages', 'id', '`id` int(11) NOT NULL AUTO_INCREMENT');

INSERT IGNORE INTO `schema_migrations` (`name`)
VALUES ('001_hardening');

DROP PROCEDURE IF EXISTS `lgs_add_column_if_missing`;
DROP PROCEDURE IF EXISTS `lgs_add_index_if_missing`;
DROP PROCEDURE IF EXISTS `lgs_modify_column_if_exists`;
