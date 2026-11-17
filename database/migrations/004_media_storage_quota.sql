-- Migrazione che registra le prenotazioni di spazio utilizzate per coordinare gli upload S3.
-- Le chiavi primarie identificano le righe; le chiavi esterne collegano tabelle e gli indici accelerano le
-- ricerche previste.
-- Prenotazioni dello spazio remoto, distinte per contenitore e oggetto.
CREATE TABLE IF NOT EXISTS media_upload_reservations (
    bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (bucket_key, object_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Registra il nome della migrazione; IGNORE evita il duplicato quando è già presente.
INSERT IGNORE INTO schema_migrations (name) VALUES ('004_media_storage_quota');
