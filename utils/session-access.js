// Verifica il ruolo attuale nel database e permette di invalidare le sessioni dopo modifiche amministrative.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// db: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece
// di aprirne una per richiesta.
const db = require('../config/db');
// parsePositiveSafeId: Converte un valore in intero positivo rappresentabile senza perdita di precisione oppure
// restituisce null.
const { parsePositiveSafeId } = require('./socket-security');

// hasCurrentRole: Confronta il ruolo nella sessione con quello attuale nel database; restituisce true solo se
// coincidono.
// Riceve: user (dati dell’utente).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
// La Promise restituisce l’esito booleano del confronto col database.
async function hasCurrentRole(user) {
    // id: Valore convertito o normalizzato prima del suo utilizzo.
    const id = parsePositiveSafeId(user?.id);
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (!id || !['ADMIN', 'COACH', 'PARTNER'].includes(user.ruolo)) return false;
    // rows: Righe restituite dalla query o dal caricamento corrente.
    // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
    const [rows] = await db.promise().execute('SELECT ruolo FROM users WHERE id = ?', [id]);
    return rows[0]?.ruolo === user.ruolo;
}

// deleteUserSessions: Elimina dal database le sessioni appartenenti all’utente indicato.
// Riceve: connection (connessione usata nell’operazione); userId (id dell’utente).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function deleteUserSessions(connection, userId) {
    // Elimina i record individuati dalle condizioni della query; i segnaposto ? ricevono i valori separati dai
    // parametri.
    await connection.execute(
        "DELETE FROM sessions WHERE JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(data), data, '{}'), '$.utenteLoggato.id')) = ?",
        [String(userId)]
    );
}

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = { deleteUserSessions, hasCurrentRole };
