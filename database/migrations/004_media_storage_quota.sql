CREATE TABLE IF NOT EXISTS media_upload_reservations (
    bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    size_bytes BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (bucket_key, object_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO schema_migrations (name) VALUES ('004_media_storage_quota');
