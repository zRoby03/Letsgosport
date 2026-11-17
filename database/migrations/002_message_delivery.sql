-- Migrazione per identificare i messaggi del client ed evitare inserimenti duplicati; ALTER non è ripetibile alla
-- cieca.
-- Le chiavi primarie identificano le righe; le chiavi esterne collegano tabelle e gli indici accelerano le
-- ricerche previste.
-- Applicare una volta al database esistente prima di pubblicare il codice.
-- Modifica la struttura della tabella esistente secondo le clausole successive.
ALTER TABLE messages
    ADD COLUMN client_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    ADD UNIQUE KEY uq_messages_user_client (user_id, client_id);

-- Registra il nome della migrazione; IGNORE evita il duplicato quando è già presente.
INSERT IGNORE INTO schema_migrations (name) VALUES ('002_message_delivery');
