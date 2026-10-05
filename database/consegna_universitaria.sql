-- Schema database LetsGoSport

CREATE DATABASE IF NOT EXISTS `letsgosport`
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_general_ci;

USE `letsgosport`;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `messages`;
DROP TABLE IF EXISTS `enrollments_gare`;
DROP TABLE IF EXISTS `enrollments_corsi`;
DROP TABLE IF EXISTS `gare`;
DROP TABLE IF EXISTS `corsi`;
DROP TABLE IF EXISTS `sessions`;
DROP TABLE IF EXISTS `schema_migrations`;
DROP TABLE IF EXISTS `users`;

SET FOREIGN_KEY_CHECKS = 1;

-- Utenti e ruoli

CREATE TABLE `users` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(150) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `ruolo` ENUM('ADMIN', 'COACH', 'PARTNER') DEFAULT 'PARTNER',
    `nome` VARCHAR(50) NOT NULL,
    `cognome` VARCHAR(50) NOT NULL,
    `eta` INT DEFAULT NULL,
    `bio` TEXT DEFAULT NULL,
    `propic` VARCHAR(255) DEFAULT 'default_user.png',
    `creato_il` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `certificato_url` VARCHAR(255) DEFAULT NULL,
    `certificato_scadenza` DATE DEFAULT NULL,
    `aggiornato_il` TIMESTAMP NULL DEFAULT NULL
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_email` (`email`),
    KEY `idx_users_ruolo` (`ruolo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Account amministratore dimostrativo per la valutazione in locale.
-- Credenziali: adminlocale@test.it / 11111111
-- Nel database la password e salvata esclusivamente come hash bcrypt.
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

CREATE TABLE `corsi` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(100) NOT NULL,
    `costo` DECIMAL(10,2) DEFAULT 0.00,
    `bio` TEXT DEFAULT NULL,
    `propic` VARCHAR(255) DEFAULT 'default_corso.png',
    `orario_inizio` TIME NOT NULL,
    `durata` INT NOT NULL,
    `giorno` ENUM(
        'Lunedi',
        'Martedi',
        'Mercoledi',
        'Giovedi',
        'Venerdi',
        'Sabato',
        'Domenica'
    ) NOT NULL,
    `coach_id` INT DEFAULT NULL,
    `creato_il` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `aggiornato_il` TIMESTAMP NULL DEFAULT NULL
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_corsi_coach_id` (`coach_id`),
    KEY `idx_corsi_giorno_orario` (`giorno`, `orario_inizio`),
    CONSTRAINT `fk_corsi_coach`
        FOREIGN KEY (`coach_id`) REFERENCES `users` (`id`)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `gare` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `nome` VARCHAR(100) NOT NULL,
    `bio` TEXT DEFAULT NULL,
    `propic` VARCHAR(255) DEFAULT 'default_gara.png',
    `giorno` DATE NOT NULL,
    `orario` TIME NOT NULL,
    `creato_il` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `costo` DECIMAL(10,2) DEFAULT 0.00,
    `aggiornato_il` TIMESTAMP NULL DEFAULT NULL
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_gare_giorno_orario` (`giorno`, `orario`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Iscrizioni

CREATE TABLE `enrollments_corsi` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `corso_id` INT NOT NULL,
    `iscritto_il` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_enrollments_corsi_user_corso` (`user_id`, `corso_id`),
    KEY `idx_enrollments_corsi_user` (`user_id`),
    KEY `idx_enrollments_corsi_corso` (`corso_id`),
    CONSTRAINT `fk_enrollments_corsi_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE,
    CONSTRAINT `fk_enrollments_corsi_corso`
        FOREIGN KEY (`corso_id`) REFERENCES `corsi` (`id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `enrollments_gare` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `gara_id` INT NOT NULL,
    `iscritto_il` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_enrollments_gare_user_gara` (`user_id`, `gara_id`),
    KEY `idx_enrollments_gare_user` (`user_id`),
    KEY `idx_enrollments_gare_gara` (`gara_id`),
    CONSTRAINT `fk_enrollments_gare_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE,
    CONSTRAINT `fk_enrollments_gare_gara`
        FOREIGN KEY (`gara_id`) REFERENCES `gare` (`id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Chat

CREATE TABLE `messages` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `room` VARCHAR(50) NOT NULL,
    `contenuto` TEXT NOT NULL,
    `data_invio` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `file_url` VARCHAR(255) DEFAULT NULL,
    `file_type` VARCHAR(100) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_messages_user_id` (`user_id`),
    KEY `idx_messages_room_data` (`room`, `data_invio`),
    KEY `idx_messages_data_invio` (`data_invio`),
    CONSTRAINT `fk_messages_user`
        FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Tabelle tecniche

-- Registro delle migrazioni applicate.
CREATE TABLE `schema_migrations` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `executed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_schema_migrations_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Persistenza delle sessioni HTTP. In esecuzione questa tabella viene creata
-- automaticamente da express-mysql-session se non esiste.
CREATE TABLE `sessions` (
    `session_id` VARCHAR(128) NOT NULL,
    `expires` INT UNSIGNED NOT NULL,
    `data` MEDIUMTEXT DEFAULT NULL,
    PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
