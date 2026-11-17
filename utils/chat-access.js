// Centralizza chi può accedere alle chat e la registrazione delle conversazioni private.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// db: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece
// di aprirne una per richiesta.
const db = require('../config/db');
// getPrivateRoomPeer: Restituisce l’altro partecipante se l’utente appartiene alla stanza privata indicata.
// normalizeChatRoom: Riconosce e normalizza i formati di stanza consentiti, verificando anche gli id dei
// partecipanti privati.
// parsePositiveSafeId: Converte un valore in intero positivo rappresentabile senza perdita di precisione oppure
// restituisce null.
const { getPrivateRoomPeer, normalizeChatRoom, parsePositiveSafeId } = require('./socket-security');

// queryAsync: Converte la query a callback in una Promise: resolve consegna le righe e reject propaga l’errore.
// Riceve: sql (istruzione SQL); params (valori separati della query).
// Restituisce una Promise risolta con i risultati SQL o rifiutata con l’errore del database.
function queryAsync(sql, params) {
    // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
    // Riceve: resolve (completa la Promise con successo); reject (completa la Promise con errore).
    return new Promise((resolve, reject) => {
        // Riceve l’esito della query a callback e gestisce errore o righe restituite.
        // Riceve: error (errore intercettato); rows (righe SQL restituite).
        db.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

// utentePuoAccedereAStanza: Verifica nel database l’accesso dell’utente alla chat generale, privata, di corso o di
// gara.
// Riceve: utente (dati dell’utente); room (identificativo della stanza).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
// La Promise restituisce l’esito booleano del controllo di accesso.
async function utentePuoAccedereAStanza(utente, room) {
    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = parsePositiveSafeId(utente?.id);
    // ruolo: Ruolo applicativo usato per stabilire le azioni consentite.
    const ruolo = String(utente?.ruolo || '').toUpperCase();
    // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
    const stanza = normalizeChatRoom(room);
    if (!userId || !stanza) return false;
    if (stanza.type === 'general') return true;

    if (stanza.type === 'private') {
        if (!stanza.userIds.includes(userId)) return false;

        // altroId: Risultato di getPrivateRoomPeer. Restituisce l’altro partecipante se l’utente appartiene alla stanza
        // privata indicata.
        const altroId = getPrivateRoomPeer(stanza.room, userId);
        if (!altroId) return false;

        // results: Risultati consegnati dall’operazione asincrona.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const results = await queryAsync(`
            SELECT id, ruolo
            FROM users
            WHERE id = ?
            LIMIT 1
        `, [altroId]);

        if (results.length === 0) return false;
        // Il caso indicato soddisfa già il controllo: restituisce subito true.
        if (ruolo === 'ADMIN' || ruolo === 'COACH') return true;
        return ['ADMIN', 'COACH'].includes(String(results[0].ruolo || '').toUpperCase());
    }

    if (stanza.type === 'corso') {
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (ruolo === 'ADMIN') {
            // results: Risultati consegnati dall’operazione asincrona.
            // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
            const results = await queryAsync(
                'SELECT id FROM corsi WHERE id = ? LIMIT 1',
                [stanza.id]
            );
            return results.length > 0;
        }

        // results: Risultati consegnati dall’operazione asincrona.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const results = await queryAsync(`
            SELECT c.id
            FROM corsi c
            LEFT JOIN enrollments_corsi ec ON ec.corso_id = c.id AND ec.user_id = ?
            WHERE c.id = ? AND (c.coach_id = ? OR ec.user_id IS NOT NULL)
            LIMIT 1
        `, [userId, stanza.id, userId]);

        return results.length > 0;
    }

    if (stanza.type === 'gara') {
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (ruolo === 'ADMIN') {
            // results: Risultati consegnati dall’operazione asincrona.
            // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
            const results = await queryAsync(
                'SELECT id FROM gare WHERE id = ? LIMIT 1',
                [stanza.id]
            );
            return results.length > 0;
        }

        // results: Risultati consegnati dall’operazione asincrona.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const results = await queryAsync(`
            SELECT gara_id
            FROM enrollments_gare
            WHERE gara_id = ? AND user_id = ?
            LIMIT 1
        `, [stanza.id, userId]);

        return results.length > 0;
    }

    return false;
}

// salvaChatPrivata: Registra la coppia ordinata dei partecipanti alla conversazione privata senza duplicarla.
// Riceve: stanza (dati della stanza).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function salvaChatPrivata(stanza) {
    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    await queryAsync(
        'INSERT INTO private_conversations (first_user_id, second_user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE first_user_id = first_user_id',
        // Confronta due elementi per stabilirne l’ordine nella raccolta.
        // Riceve: first (primo elemento confrontato); second (secondo elemento confrontato).
        [...stanza.userIds].sort((first, second) => first - second)
    );
}

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = { salvaChatPrivata, utentePuoAccedereAStanza };
