-- Migrazione per conservare le conversazioni private e ricostruirle dai messaggi esistenti validi.
-- Le chiavi primarie identificano le righe; le chiavi esterne collegano tabelle e gli indici accelerano le
-- ricerche previste.
-- Coppie ordinate di utenti che hanno una conversazione privata.
CREATE TABLE IF NOT EXISTS private_conversations (
    first_user_id INT NOT NULL,
    second_user_id INT NOT NULL,
    -- Definisce l’identificativo univoco della riga, eventualmente composto da più colonne.
    PRIMARY KEY (first_user_id, second_user_id),
    -- Indicizza le colonne usate dalle ricerche o dalle relazioni.
    KEY idx_private_conversations_second (second_user_id),
    -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
    CONSTRAINT fk_private_conversations_first FOREIGN KEY (first_user_id) REFERENCES users (id) ON DELETE CASCADE,
    -- Definisce il vincolo di relazione verso la tabella e le colonne referenziate.
    CONSTRAINT fk_private_conversations_second FOREIGN KEY (second_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Inserisce le coppie di partecipanti ricostruite dai messaggi esistenti.
INSERT IGNORE INTO private_conversations (first_user_id, second_user_id)
-- Seleziona i record necessari al controllo o alla ricostruzione dei dati.
SELECT DISTINCT first_user.id, second_user.id
FROM messages m
JOIN users first_user ON first_user.id = CASE
    WHEN m.room REGEXP '^private_[1-9][0-9]{0,9}_[1-9][0-9]{0,9}$'
    THEN CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(m.room, '_', 2), '_', -1) AS UNSIGNED) END
JOIN users second_user ON second_user.id = CASE
    WHEN m.room REGEXP '^private_[1-9][0-9]{0,9}_[1-9][0-9]{0,9}$'
    THEN CAST(SUBSTRING_INDEX(m.room, '_', -1) AS UNSIGNED) END
-- Limita le righe alle condizioni richieste dall’operazione.
WHERE m.room REGEXP '^private_[1-9][0-9]{0,9}_[1-9][0-9]{0,9}$'
    AND first_user.id < second_user.id;

-- Registra il nome della migrazione; IGNORE evita il duplicato quando è già presente.
INSERT IGNORE INTO schema_migrations (name) VALUES ('003_private_conversations');
