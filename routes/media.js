// Serve i file via HTTP: gli allegati della chat richiedono autorizzazione, le immagini pubbliche un riferimento
// nel database.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// express: Express definisce router, middleware e risposte HTTP.
const express = require('express');
// db: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece
// di aprirne una per richiesta.
const db = require('../config/db');
// sendMedia: Trasmette il media nella risposta HTTP, gestendo anche le richieste di intervalli di byte.
const { sendMedia } = require('../config/media-storage');
// mediaTypeForName: Ricava un MIME riconosciuto dall’estensione di un nome sicuro oppure restituisce null.
const { mediaTypeForName } = require('../config/upload');
// utentePuoAccedereAStanza: Verifica nel database l’accesso dell’utente alla chat generale, privata, di corso o di
// gara.
const { utentePuoAccedereAStanza } = require('../utils/chat-access');
// parsePositiveSafeId: Converte un valore in intero positivo rappresentabile senza perdita di precisione oppure
// restituisce null.
const { parsePositiveSafeId } = require('../utils/socket-security');

// router: Router Express che raggruppa gli endpoint di questo modulo.
const router = express.Router();

// query: Converte la query SQL a callback in una Promise utilizzabile con await.
// Riceve: sql (istruzione SQL); params (valori separati della query).
// Restituisce una Promise con le righe SQL oppure propaga l’errore della query.
function query(sql, params) {
    // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
    // Riceve: resolve (completa la Promise con successo); reject (completa la Promise con errore).
    return new Promise((resolve, reject) => {
        // Riceve l’esito della query a callback e gestisce errore o righe restituite.
        // Riceve: error (errore intercettato); rows (righe SQL restituite).
        db.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

// Gestisce la rotta GET /api/chat/allegati/:id e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.get('/api/chat/allegati/:id', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = parsePositiveSafeId(req.session.utenteLoggato?.id);
    if (!userId) return res.sendStatus(401);
    // messageId: Identificativo del messaggio che contiene l’allegato o deve essere elaborato.
    const messageId = parsePositiveSafeId(req.params.id);
    if (!messageId) return res.sendStatus(404);

    // attachment: Dati restituiti dal database al completamento della query.
    // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
    const [attachment] = await query(
        'SELECT m.room, m.file_url, u.id, u.ruolo FROM messages m JOIN users u ON u.id = ? WHERE m.id = ?',
        [userId, messageId]
    );
    if (!attachment?.file_url || !await utentePuoAccedereAStanza(attachment, attachment.room)) {
        return res.sendStatus(404);
    }
    // mimetype: Risultato di mediaTypeForName. Ricava un MIME riconosciuto dall’estensione di un nome sicuro oppure
    // restituisce null.
    const mimetype = mediaTypeForName(attachment.file_url);
    if (!mimetype) return res.sendStatus(404);
    if (mimetype === 'application/pdf') res.attachment(attachment.file_url);
    return sendMedia(req, res, attachment.file_url, mimetype);
});

// Gestisce la rotta GET /uploads/:filename e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.get('/uploads/:filename', async (req, res) => {
    // filename: Valore della proprietà req.params, conservato per le operazioni successive.
    const { filename } = req.params;
    // mimetype: Risultato di mediaTypeForName. Ricava un MIME riconosciuto dall’estensione di un nome sicuro oppure
    // restituisce null.
    const mimetype = mediaTypeForName(filename);
    if (!mimetype?.startsWith('image/')) return res.sendStatus(404);

    // row: Dati restituiti dal database al completamento della query.
    // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
    const [row] = await query(
        'SELECT (EXISTS(SELECT 1 FROM users WHERE propic = ?) OR EXISTS(SELECT 1 FROM corsi WHERE propic = ?) OR EXISTS(SELECT 1 FROM gare WHERE propic = ?)) AND NOT EXISTS(SELECT 1 FROM messages WHERE file_url = ?) AS visible',
        [filename, filename, filename, filename]
    );
    if (!row?.visible) return res.sendStatus(404);
    return sendMedia(req, res, filename, mimetype);
});

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = router;
