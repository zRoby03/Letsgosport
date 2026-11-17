-- Schema di installazione: ricrea le tabelle e inserisce dati dimostrativi; i DROP eliminano eventuali dati
-- preesistenti.
-- Le chiavi primarie identificano le righe; le chiavi esterne collegano tabelle e gli indici accelerano le
-- ricerche previste.
-- Schema database LetsGoSport

-- Prepara il database con il set di caratteri e la collazione dichiarati.
CREATE DATABASE IF NOT EXISTS `letsgosport`
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_general_ci;

-- Seleziona il database a cui si applicano le istruzioni successive.
USE `letsgosport`;

-- Disattiva temporaneamente i controlli delle relazioni durante la ricreazione delle tabelle.
SET FOREIGN_KEY_CHECKS = 0;

-- Elimina la tabella private_conversations e i suoi dati, se esiste.
DROP TABLE IF EXISTS `private_conversations`;
-- Elimina la tabella media_upload_reservations e i suoi dati, se esiste.
DROP TABLE IF EXISTS `media_upload_reservations`;
-- Elimina la tabella messages e i suoi dati, se esiste.
DROP TABLE IF EXISTS `messages`;
-- Elimina la tabella enrollments_gare e i suoi dati, se esiste.
DROP TABLE IF EXISTS `enrollments_gare`;
-- Elimina la tabella enrollments_corsi e i suoi dati, se esiste.
DROP TABLE IF EXISTS `enrollments_corsi`;
-- Elimina la tabella gare e i suoi dati, se esiste.
DROP TABLE IF EXISTS `gare`;
-- Elimina la tabella corsi e i suoi dati, se esiste.
DROP TABLE IF EXISTS `corsi`;
-- Elimina la tabella sessions e i suoi dati, se esiste.
DROP TABLE IF EXISTS `sessions`;
-- Elimina la tabella schema_migrations e i suoi dati, se esiste.
DROP TABLE IF EXISTS `schema_migrations`;
-- Elimina la tabella users e i suoi dati, se esiste.
DROP TABLE IF EXISTS `users`;

-- Riattiva i controlli sulle chiavi esterne dopo la rimozione delle strutture precedenti.
SET FOREIGN_KEY_CHECKS = 1;

-- Utenti e ruoli

-- Utenti: identità, hash della password, ruolo e informazioni del profilo.
CREATE TABLE `users` (
    -- Identificativo numerico della riga; AUTO_INCREMENT lo assegna agli inserimenti.
    `id` INT NOT NULL AUTO_INCREMENT,
    -- Indirizzo dell’account, sottoposto al vincolo di unicità previsto.
    `email` VARCHAR(150) NOT NULL,
    -- Hash della password; la verifica applicativa usa bcrypt.
    `password` VARCHAR(255) NOT NULL,
    -- Ruolo applicativo scelto fra quelli ammessi dall’ENUM.
    `ruolo` ENUM('ADMIN', 'COACH', 'PARTNER') DEFAULT 'PARTNER',
    -- Nome o titolo dell’elemento rappresentato dalla tabella.
    `nome` VARCHAR(50) NOT NULL,
    -- Cognome della persona.
    `cognome` VARCHAR(50) NOT NULL,
    -- Età facoltativa dell’utente.
    `eta` INT DEFAULT NULL,
    -- Descrizione estesa del profilo, corso o gara.
    `bio` TEXT DEFAULT NULL,
    -- Nome dell’immagine associata; il percorso viene gestito dall’applicazione.
    `propic` VARCHAR(255) DEFAULT 'default_user.png',
    -- Data e ora di creazione, inizializzate dal database.
    `creato_il` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Riferimento facoltativo al certificato dell’utente.
    `certificato_url` VARCHAR(255) DEFAULT NULL,
    -- Data di scadenza facoltativa del certificato.
    `certificato_scadenza` DATE DEFAULT NULL,
    -- Data e ora dell’ultima modifica secondo la clausola di aggiornamento.
    `aggiornato_il` TIMESTAMP NULL DEFAULT NULL
        -- Aggiorna automaticamente il riferimento temporale quando cambia la riga.
        ON UPDATE CURRENT_TIMESTAMP,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (`id`),
    -- Impedisce duplicati della combinazione di colonne indicata.
    UNIQUE KEY `uq_users_email` (`email`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_users_ruolo` (`ruolo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Account amministratore dimostrativo per la valutazione in locale.
-- Credenziali: adminlocale@test.it / 11111111
-- Nel database la password e salvata esclusivamente come hash bcrypt.
-- Inserisce i dati previsti dall’installazione, usando i valori definiti nelle righe successive.
INSERT INTO `users` (`email`, `password`, `ruolo`, `nome`, `cognome`, `bio`)
VALUES (
    'adminlocale@test.it',
    '$2b$10$t308TZ.rwnlOvJEZxtniEukLf3w9B7bEu8wsYght/xWVoE8nYP6/.',
    'ADMIN',
    'Admin',
    'Locale',
    'Account dimostrativo per la valutazione universitaria in locale.'
);

-- Corsi e gare

-- Corsi: descrizione, costo, calendario e coach assegnato.
CREATE TABLE `corsi` (
    -- Identificativo numerico della riga; AUTO_INCREMENT lo assegna agli inserimenti.
    `id` INT NOT NULL AUTO_INCREMENT,
    -- Nome o titolo dell’elemento rappresentato dalla tabella.
    `nome` VARCHAR(100) NOT NULL,
    -- Importo decimale con due cifre dopo la virgola.
    `costo` DECIMAL(10,2) DEFAULT 0.00,
    -- Descrizione estesa del profilo, corso o gara.
    `bio` TEXT DEFAULT NULL,
    -- Nome dell’immagine associata; il percorso viene gestito dall’applicazione.
    `propic` VARCHAR(255) DEFAULT 'default_corso.png',
    -- Ora di inizio del corso.
    `orario_inizio` TIME NOT NULL,
    -- Durata numerica del corso, utilizzata dall’interfaccia.
    `durata` INT NOT NULL,
    -- Giorno del corso o data della gara secondo il tipo SQL dichiarato.
    `giorno` ENUM(
        'Lunedi',
        'Martedi',
        'Mercoledi',
        'Giovedi',
        'Venerdi',
        'Sabato',
        'Domenica'
    ) NOT NULL,
    -- Utente assegnato al corso come coach; può essere assente quando ammesso.
    `coach_id` INT DEFAULT NULL,
    -- Data e ora di creazione, inizializzate dal database.
    `creato_il` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Data e ora dell’ultima modifica secondo la clausola di aggiornamento.
    `aggiornato_il` TIMESTAMP NULL DEFAULT NULL
        -- Aggiorna automaticamente il riferimento temporale quando cambia la riga.
        ON UPDATE CURRENT_TIMESTAMP,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (`id`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_corsi_coach_id` (`coach_id`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_corsi_giorno_orario` (`giorno`, `orario_inizio`),
    -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
    CONSTRAINT `fk_corsi_coach`
        -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
        FOREIGN KEY (`coach_id`) REFERENCES `users` (`id`)
        -- La cancellazione del riferimento conserva questa riga e svuota la chiave esterna.
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Gare: descrizione, data, orario e costo.
CREATE TABLE `gare` (
    -- Identificativo numerico della riga; AUTO_INCREMENT lo assegna agli inserimenti.
    `id` INT NOT NULL AUTO_INCREMENT,
    -- Nome o titolo dell’elemento rappresentato dalla tabella.
    `nome` VARCHAR(100) NOT NULL,
    -- Descrizione estesa del profilo, corso o gara.
    `bio` TEXT DEFAULT NULL,
    -- Nome dell’immagine associata; il percorso viene gestito dall’applicazione.
    `propic` VARCHAR(255) DEFAULT 'default_gara.png',
    -- Giorno del corso o data della gara secondo il tipo SQL dichiarato.
    `giorno` DATE NOT NULL,
    -- Ora di svolgimento della gara.
    `orario` TIME NOT NULL,
    -- Data e ora di creazione, inizializzate dal database.
    `creato_il` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Importo decimale con due cifre dopo la virgola.
    `costo` DECIMAL(10,2) DEFAULT 0.00,
    -- Data e ora dell’ultima modifica secondo la clausola di aggiornamento.
    `aggiornato_il` TIMESTAMP NULL DEFAULT NULL
        -- Aggiorna automaticamente il riferimento temporale quando cambia la riga.
        ON UPDATE CURRENT_TIMESTAMP,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (`id`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_gare_giorno_orario` (`giorno`, `orario`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Iscrizioni

-- Associa utenti e corsi per registrare le iscrizioni.
CREATE TABLE `enrollments_corsi` (
    -- Identificativo numerico della riga; AUTO_INCREMENT lo assegna agli inserimenti.
    `id` INT NOT NULL AUTO_INCREMENT,
    -- Identificativo dell’utente collegato tramite la relazione prevista.
    `user_id` INT NOT NULL,
    -- Identificativo del corso a cui si riferisce l’iscrizione.
    `corso_id` INT NOT NULL,
    -- Data e ora in cui viene registrata l’iscrizione.
    `iscritto_il` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (`id`),
    -- Impedisce duplicati della combinazione di colonne indicata.
    UNIQUE KEY `uq_enrollments_corsi_user_corso` (`user_id`, `corso_id`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_enrollments_corsi_user` (`user_id`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_enrollments_corsi_corso` (`corso_id`),
    -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
    CONSTRAINT `fk_enrollments_corsi_user`
        -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        -- La cancellazione della riga collegata elimina anche le righe dipendenti di questa relazione.
        ON DELETE CASCADE,
    -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
    CONSTRAINT `fk_enrollments_corsi_corso`
        -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
        FOREIGN KEY (`corso_id`) REFERENCES `corsi` (`id`)
        -- La cancellazione della riga collegata elimina anche le righe dipendenti di questa relazione.
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Associa utenti e gare per registrare le iscrizioni.
CREATE TABLE `enrollments_gare` (
    -- Identificativo numerico della riga; AUTO_INCREMENT lo assegna agli inserimenti.
    `id` INT NOT NULL AUTO_INCREMENT,
    -- Identificativo dell’utente collegato tramite la relazione prevista.
    `user_id` INT NOT NULL,
    -- Identificativo della gara a cui si riferisce l’iscrizione.
    `gara_id` INT NOT NULL,
    -- Data e ora in cui viene registrata l’iscrizione.
    `iscritto_il` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (`id`),
    -- Impedisce duplicati della combinazione di colonne indicata.
    UNIQUE KEY `uq_enrollments_gare_user_gara` (`user_id`, `gara_id`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_enrollments_gare_user` (`user_id`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_enrollments_gare_gara` (`gara_id`),
    -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
    CONSTRAINT `fk_enrollments_gare_user`
        -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        -- La cancellazione della riga collegata elimina anche le righe dipendenti di questa relazione.
        ON DELETE CASCADE,
    -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
    CONSTRAINT `fk_enrollments_gare_gara`
        -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
        FOREIGN KEY (`gara_id`) REFERENCES `gare` (`id`)
        -- La cancellazione della riga collegata elimina anche le righe dipendenti di questa relazione.
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Chat

-- Messaggi della chat, con stanza, autore e riferimenti agli allegati.
CREATE TABLE `messages` (
    -- Identificativo numerico della riga; AUTO_INCREMENT lo assegna agli inserimenti.
    `id` INT NOT NULL AUTO_INCREMENT,
    -- Identificativo dell’utente collegato tramite la relazione prevista.
    `user_id` INT NOT NULL,
    -- Nome canonico della stanza della chat.
    `room` VARCHAR(50) NOT NULL,
    -- Testo del messaggio.
    `contenuto` TEXT NOT NULL,
    -- Data e ora di inserimento del messaggio.
    `data_invio` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Nome del file allegato, servito tramite i controlli applicativi.
    `file_url` VARCHAR(255) DEFAULT NULL,
    -- Tipo MIME dell’allegato associato al messaggio.
    `file_type` VARCHAR(100) DEFAULT NULL,
    -- Identificatore del client usato con l’utente per evitare duplicazioni dei messaggi.
    `client_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (`id`),
    -- Impedisce duplicati della combinazione di colonne indicata.
    UNIQUE KEY `uq_messages_user_client` (`user_id`, `client_id`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_messages_user_id` (`user_id`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_messages_room_data` (`room`, `data_invio`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_messages_data_invio` (`data_invio`),
    -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
    CONSTRAINT `fk_messages_user`
        -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        -- La cancellazione della riga collegata elimina anche le righe dipendenti di questa relazione.
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Coppie ordinate di utenti che hanno una conversazione privata.
CREATE TABLE `private_conversations` (
    -- Primo partecipante della coppia privata ordinata.
    `first_user_id` INT NOT NULL,
    -- Secondo partecipante della coppia privata ordinata.
    `second_user_id` INT NOT NULL,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (`first_user_id`, `second_user_id`),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY `idx_private_conversations_second` (`second_user_id`),
    -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
    CONSTRAINT `fk_private_conversations_first` FOREIGN KEY (`first_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
    -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
    CONSTRAINT `fk_private_conversations_second` FOREIGN KEY (`second_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Tabelle tecniche

-- Prenotazioni dello spazio remoto, distinte per contenitore e oggetto.
CREATE TABLE `media_upload_reservations` (
    -- Impronta del contenitore remoto usata per coordinare le prenotazioni.
    `bucket_key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Chiave del file nello storage remoto.
    `object_key` VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    -- Dimensione dello spazio prenotato in byte.
    `size_bytes` BIGINT UNSIGNED NOT NULL,
    -- Istante di creazione della prenotazione.
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (`bucket_key`, `object_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Registro delle migrazioni applicate.
-- Registro delle migrazioni SQL già dichiarate come applicate.
CREATE TABLE `schema_migrations` (
    -- Identificativo numerico della riga; AUTO_INCREMENT lo assegna agli inserimenti.
    `id` INT NOT NULL AUTO_INCREMENT,
    -- Nome univoco della migrazione registrata.
    `name` VARCHAR(150) NOT NULL,
    -- Data e ora di registrazione della migrazione.
    `executed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (`id`),
    -- Impedisce duplicati della combinazione di colonne indicata.
    UNIQUE KEY `uq_schema_migrations_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Persistenza delle sessioni HTTP. In esecuzione questa tabella viene creata
-- automaticamente da express-mysql-session se non esiste.
-- Sessioni HTTP conservate dal server; il cookie contiene soltanto il loro identificativo.
CREATE TABLE `sessions` (
    -- Identificativo della sessione associato al cookie HTTP.
    `session_id` VARCHAR(128) NOT NULL,
    -- Scadenza numerica della sessione nel formato usato dall’archivio.
    `expires` INT UNSIGNED NOT NULL,
    -- Dati serializzati della sessione conservati sul server.
    `data` MEDIUMTEXT DEFAULT NULL,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
