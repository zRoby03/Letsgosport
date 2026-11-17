-- Migrazione che controlla colonne e indici tramite information_schema prima delle modifiche previste.
-- Le chiavi primarie identificano le righe; le chiavi esterne collegano tabelle e gli indici accelerano le
-- ricerche previste.
-- Seleziona il database a cui si applicano le istruzioni successive.
USE `letsgosport`;

-- Migrazione non distruttiva per il database reale XAMPP.
-- Prima di eseguirla: fare sempre export/backup da phpMyAdmin.

-- Registro delle migrazioni SQL già dichiarate come applicate.
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  -- Identificativo numerico della riga; AUTO_INCREMENT lo assegna agli inserimenti.
  `id` int(11) NOT NULL AUTO_INCREMENT,
  -- Nome univoco della migrazione registrata.
  `name` varchar(150) NOT NULL,
  -- Data e ora di registrazione della migrazione.
  `executed_at` timestamp NOT NULL DEFAULT current_timestamp(),
  -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
  PRIMARY KEY (`id`),
  -- Impedisce duplicati della combinazione di colonne indicata.
  UNIQUE KEY `uq_schema_migrations_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Cambia il delimitatore del client SQL per poter definire le procedure con istruzioni interne.
DELIMITER $$

-- Definisce una procedura di supporto alla migrazione, richiamata dalle istruzioni CALL.
CREATE PROCEDURE `lgs_add_column_if_missing`(
  -- Parametro: nome della tabella da verificare nei metadati.
  IN table_name_in varchar(64),
  -- Parametro: nome della colonna da cercare nei metadati.
  IN column_name_in varchar(64),
  -- Parametro: frammento DDL controllato dalle chiamate della migrazione.
  IN ddl_in text
)
BEGIN
  -- Consulta information_schema per decidere se eseguire la modifica della struttura.
  IF NOT EXISTS (
    -- Seleziona i record necessari al controllo o alla ricostruzione dei dati.
    SELECT 1
    FROM information_schema.COLUMNS
    -- Limita le righe alle condizioni richieste dall’operazione.
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_in
      AND COLUMN_NAME = column_name_in
  ) THEN
    -- Compone l’istruzione DDL dinamica dai parametri della procedura.
    SET @sql = CONCAT('ALTER TABLE `', table_name_in, '` ADD COLUMN ', ddl_in);
    -- Prepara l’istruzione SQL dinamica memorizzata nella variabile di sessione.
    PREPARE stmt FROM @sql;
    -- Esegue l’istruzione dinamica appena preparata.
    EXECUTE stmt;
    -- Libera l’istruzione preparata dopo l’esecuzione.
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

-- Definisce una procedura di supporto alla migrazione, richiamata dalle istruzioni CALL.
CREATE PROCEDURE `lgs_add_index_if_missing`(
  -- Parametro: nome della tabella da verificare nei metadati.
  IN table_name_in varchar(64),
  -- Parametro: nome dell’indice da cercare nei metadati.
  IN index_name_in varchar(64),
  -- Parametro: frammento DDL controllato dalle chiamate della migrazione.
  IN ddl_in text
)
BEGIN
  -- Consulta information_schema per decidere se eseguire la modifica della struttura.
  IF NOT EXISTS (
    -- Seleziona i record necessari al controllo o alla ricostruzione dei dati.
    SELECT 1
    FROM information_schema.STATISTICS
    -- Limita le righe alle condizioni richieste dall’operazione.
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_in
      AND INDEX_NAME = index_name_in
  ) THEN
    -- Compone l’istruzione DDL dinamica dai parametri della procedura.
    SET @sql = CONCAT('ALTER TABLE `', table_name_in, '` ADD ', ddl_in);
    -- Prepara l’istruzione SQL dinamica memorizzata nella variabile di sessione.
    PREPARE stmt FROM @sql;
    -- Esegue l’istruzione dinamica appena preparata.
    EXECUTE stmt;
    -- Libera l’istruzione preparata dopo l’esecuzione.
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

-- Definisce una procedura di supporto alla migrazione, richiamata dalle istruzioni CALL.
CREATE PROCEDURE `lgs_modify_column_if_exists`(
  -- Parametro: nome della tabella da verificare nei metadati.
  IN table_name_in varchar(64),
  -- Parametro: nome della colonna da cercare nei metadati.
  IN column_name_in varchar(64),
  -- Parametro: frammento DDL controllato dalle chiamate della migrazione.
  IN ddl_in text
)
BEGIN
  -- Consulta information_schema per decidere se eseguire la modifica della struttura.
  IF EXISTS (
    -- Seleziona i record necessari al controllo o alla ricostruzione dei dati.
    SELECT 1
    FROM information_schema.COLUMNS
    -- Limita le righe alle condizioni richieste dall’operazione.
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_in
      AND COLUMN_NAME = column_name_in
  ) THEN
    -- Compone l’istruzione DDL dinamica dai parametri della procedura.
    SET @sql = CONCAT('ALTER TABLE `', table_name_in, '` MODIFY COLUMN ', ddl_in);
    -- Prepara l’istruzione SQL dinamica memorizzata nella variabile di sessione.
    PREPARE stmt FROM @sql;
    -- Esegue l’istruzione dinamica appena preparata.
    EXECUTE stmt;
    -- Libera l’istruzione preparata dopo l’esecuzione.
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

-- Cambia il delimitatore del client SQL per poter definire le procedure con istruzioni interne.
DELIMITER ;

-- Colonne utili per audit futuro. Il codice attuale non dipende da queste colonne.
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_add_column_if_missing('users', 'aggiornato_il', '`aggiornato_il` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()');
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_add_column_if_missing('corsi', 'aggiornato_il', '`aggiornato_il` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()');
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_add_column_if_missing('gare', 'aggiornato_il', '`aggiornato_il` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()');

-- Spazio MIME piu ampio per file audio/browser diversi.
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_modify_column_if_exists('messages', 'file_type', '`file_type` varchar(100) DEFAULT NULL');

-- Indici utili per viste e filtri frequenti.
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_add_index_if_missing('users', 'idx_users_ruolo', 'KEY `idx_users_ruolo` (`ruolo`)');
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_add_index_if_missing('gare', 'idx_gare_giorno_orario', 'KEY `idx_gare_giorno_orario` (`giorno`, `orario`)');
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_add_index_if_missing('corsi', 'idx_corsi_giorno_orario', 'KEY `idx_corsi_giorno_orario` (`giorno`, `orario_inizio`)');
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_add_index_if_missing('messages', 'idx_messages_data_invio', 'KEY `idx_messages_data_invio` (`data_invio`)');

-- Default coerenti con gli asset del progetto.
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_modify_column_if_exists('users', 'propic', '`propic` varchar(255) DEFAULT ''default_user.png''');
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_modify_column_if_exists('corsi', 'propic', '`propic` varchar(255) DEFAULT ''default_corso.png''');
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_modify_column_if_exists('gare', 'propic', '`propic` varchar(255) DEFAULT ''default_gara.png''');

-- Fix di emergenza: Assicuriamoci che l'ID dei messaggi si autoincrementi sempre!
-- Richiama la procedura di supporto con tabella, colonna o indice e DDL previsti dalla migrazione.
CALL lgs_modify_column_if_exists('messages', 'id', '`id` int(11) NOT NULL AUTO_INCREMENT');

-- Registra il nome della migrazione; IGNORE evita il duplicato quando è già presente.
INSERT IGNORE INTO `schema_migrations` (`name`)
VALUES ('001_hardening');

-- Rimuove la procedura temporanea dopo le operazioni della migrazione.
DROP PROCEDURE IF EXISTS `lgs_add_column_if_missing`;
-- Rimuove la procedura temporanea dopo le operazioni della migrazione.
DROP PROCEDURE IF EXISTS `lgs_add_index_if_missing`;
-- Rimuove la procedura temporanea dopo le operazioni della migrazione.
DROP PROCEDURE IF EXISTS `lgs_modify_column_if_exists`;
