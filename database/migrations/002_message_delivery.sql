-- Applicare una volta al database esistente prima di pubblicare il codice.
ALTER TABLE messages
    ADD COLUMN client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    ADD UNIQUE KEY uq_messages_user_client (user_id, client_id);

INSERT IGNORE INTO schema_migrations (name) VALUES ('002_message_delivery');
