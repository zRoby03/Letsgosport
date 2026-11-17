// API utente sotto /api: profilo, iscrizioni, stanze chat, upload autorizzati e configurazione ICE delle chiamate.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// express: Express definisce router, middleware e risposte HTTP.
const express = require('express');
// getIceServers: Restituisce server ICE con credenziali temporanee dopo i controlli su configurazione ed email
// autorizzate.
const { getIceServers } = require('../config/turn');
// router: Router Express che raggruppa gli endpoint di questo modulo.
const router = express.Router();
// db: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece
// di aprirne una per richiesta.
const db = require('../config/db');
// uploadProfilo: Importa il modulo locale. Multer legge i form multipart; questo modulo controlla estensioni,
// MIME, firme dei file e salvataggio.
// uploadChat: Importa il modulo locale. Multer legge i form multipart; questo modulo controlla estensioni, MIME,
// firme dei file e salvataggio.
const { uploadProfilo, uploadChat } = require('../config/upload');
// salvaChatPrivata: Registra la coppia ordinata dei partecipanti alla conversazione privata senza duplicarla.
// utentePuoAccedereAStanza: Verifica nel database l’accesso dell’utente alla chat generale, privata, di corso o di
// gara.
const { salvaChatPrivata, utentePuoAccedereAStanza } = require('../utils/chat-access');
// CHAT_UPLOAD_TOKEN_TTL_MS: Durata dei token di upload esportata dal modulo di sicurezza.
// createChatUploadToken: Crea un token firmato con nome, MIME, utente, stanza e scadenza dell’upload.
// removeUploadedFile: Rimuove un upload generato dall’applicazione; restituisce l’esito senza propagare errori di
// cancellazione.
// removeUploadedFileIfUnused: Cancella il file soltanto se è un upload riconosciuto e non risultano riferimenti
// nel database.
const {
    CHAT_UPLOAD_TOKEN_TTL_MS,
    createChatUploadToken,
    removeUploadedFile,
    removeUploadedFileIfUnused
} = require('../utils/file-security');
// normalizeChatRoom: Riconosce e normalizza i formati di stanza consentiti, verificando anche gli id dei
// partecipanti privati.
const {
    normalizeChatRoom
} = require('../utils/socket-security');
// parsePositiveId: Converte il valore in un identificativo intero positivo oppure restituisce null.
// validateUserUpdate: Valida i campi del profilo modificabili dall’utente e restituisce value oppure error.
const {
    parsePositiveId,
    validateUserUpdate
} = require('../utils/validation');

// requireAuth: Blocca con HTTP 401 le richieste prive di utente autenticato nella sessione.
// Riceve: req (richiesta HTTP); res (risposta HTTP); next (passaggio al middleware successivo).
function requireAuth(req, res, next) {
    // Se il controllo non permette l’accesso, termina la richiesta con lo stato HTTP indicato.
    if (!req.session.utenteLoggato) {
        return res.status(401).json({ errore: 'Devi accedere.' });
    }
    next();
}

// Gestisce la rotta GET /chiamate/ice e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.get('/chiamate/ice', requireAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        // iceServers: Server STUN/TURN usati dal browser per trovare i percorsi di rete della chiamata.
        res.json({ iceServers: await getIceServers(req.session.utenteLoggato) });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Configurazione chiamate:', error.code || 'TURN_ERROR');
        res.status(error.status || 503).json({ errore: error.status === 403
            ? 'Questo account non è abilitato al relay delle chiamate.'
            : 'Servizio di connessione per le chiamate temporaneamente non disponibile. Riprova.' });
    }
});

// queryAsync: Converte la query a callback in una Promise: resolve consegna le righe e reject propaga l’errore.
// Riceve: sql (istruzione SQL); params (valori separati della query).
// Restituisce una Promise risolta con i risultati SQL o rifiutata con l’errore del database.
function queryAsync(sql, params = []) {
    // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
    // Riceve: resolve (completa la Promise con successo); reject (completa la Promise con errore).
    return new Promise((resolve, reject) => {
        // Riceve l’esito della query a callback e gestisce errore o righe restituite.
        // Riceve: error (errore intercettato); results (risultati dell’operazione).
        db.query(sql, params, (error, results) => {
            if (error) reject(error);
            else resolve(results);
        });
    });
}

// getRoomNumericId: Estrae l’identificativo numerico da una stanza con il prefisso richiesto oppure restituisce
// null.
// Riceve: roomId (id della stanza); prefix (prefisso della stanza).
function getRoomNumericId(roomId, prefix) {
    // match: Corrispondenza trovata dall’espressione regolare.
    const match = new RegExp(`^${prefix}_(\\d+)$`).exec(roomId || '');
    return match ? Number(match[1]) : null;
}

// requireChatUploadAccess: Verifica stanza e permessi prima di permettere al middleware successivo di ricevere un
// allegato.
// Riceve: req (richiesta HTTP); res (risposta HTTP); next (passaggio al middleware successivo).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function requireChatUploadAccess(req, res, next) {
    // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
    const stanza = normalizeChatRoom(req.query.room);
    if (!stanza) return res.status(400).json({ errore: 'Stanza chat non valida.' });

    try {
        // Se il controllo non permette l’accesso, termina la richiesta con lo stato HTTP indicato.
        if (!await utentePuoAccedereAStanza(req.session.utenteLoggato, stanza.room)) {
            return res.status(403).json({ errore: 'Non hai i permessi per caricare file in questa chat.' });
        }
        req.chatUploadRoom = stanza;
        next();
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Errore autorizzazione upload chat:', error.code || error.message);
        res.status(500).json({ errore: 'Errore autorizzazione upload.' });
    }
}

// programmaPuliziaUploadChat: Programma la verifica e pulizia del file dopo la durata del token di upload.
// Riceve: filename (nome del file).
function programmaPuliziaUploadChat(filename) {
    // timer: Identificativo del temporizzatore, usato per annullarlo o gestirne la durata.
    // Esegue l’azione alla scadenza del temporizzatore previsto.
    const timer = setTimeout(() => {
        removeUploadedFileIfUnused(filename, db);
    }, CHAT_UPLOAD_TOKEN_TTL_MS + 30 * 1000);

    if (typeof timer.unref === 'function') timer.unref();
}

// utentePuoEliminareMessaggiStanza: Calcola i permessi di moderazione in base al ruolo e ai corsi gestiti
// dall’utente.
// Riceve: stanza (dati della stanza); user (dati dell’utente); managedCourseIds (insieme dei corsi gestiti dal
// coach).
function utentePuoEliminareMessaggiStanza(stanza, user, managedCourseIds) {
    // ruolo: Ruolo applicativo usato per stabilire le azioni consentite.
    const ruolo = String(user.ruolo || '').toUpperCase();
    // Il caso indicato soddisfa già il controllo: restituisce subito true.
    if (ruolo === 'ADMIN') return true;
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (ruolo !== 'COACH') return false;

    if (stanza.tipo === 'private') return true;
    if (stanza.tipo !== 'corso') return false;

    // courseId: Identificativo del corso interessato.
    const courseId = getRoomNumericId(stanza.room_id, 'corso');
    return managedCourseIds.has(courseId);
}

// preparaStanzeChat: Arricchisce le stanze con conteggi dei partecipanti e permessi, evitando i doppi conteggi
// previsti nelle query.
// Riceve: stanze (elenco delle stanze); user (dati dell’utente).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
// La Promise restituisce le stanze arricchite con conteggio e permessi.
async function preparaStanzeChat(stanze, user) {
    // courseIds: Identificativi dei corsi a cui si riferiscono le stanze.
    // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
    // Riceve: stanza (dati della stanza).
    // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
    const courseIds = stanze.filter(stanza => stanza.tipo === 'corso').map(stanza => getRoomNumericId(stanza.room_id, 'corso'));
    // raceIds: Identificativi delle gare a cui si riferiscono le stanze.
    // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
    // Riceve: stanza (dati della stanza).
    // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
    const raceIds = stanze.filter(stanza => stanza.tipo === 'gara').map(stanza => getRoomNumericId(stanza.room_id, 'gara'));
    // counts: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    // courses: Elenco dei corsi recuperati o filtrati.
    // races: Elenco delle gare recuperate o filtrate.
    const [counts, courses, races] = await Promise.all([
        // Legge i dati necessari dal database.
        queryAsync("SELECT COUNT(*) AS total, SUM(ruolo = 'ADMIN') AS admins FROM users"),
        courseIds.length ? queryAsync(
            "SELECT c.id, c.coach_id, CASE WHEN coach.id IS NOT NULL AND coach.ruolo <> 'ADMIN' THEN 1 ELSE 0 END AS coach_extra, " +
            "(SELECT COUNT(*) FROM enrollments_corsi e JOIN users u ON u.id = e.user_id " +
            "WHERE e.corso_id = c.id AND u.ruolo <> 'ADMIN' AND NOT (e.user_id <=> c.coach_id)) AS enrolled " +
            "FROM corsi c LEFT JOIN users coach ON coach.id = c.coach_id WHERE c.id IN (?)", [courseIds]
        ) : [],
        raceIds.length ? queryAsync(
            "SELECT e.gara_id AS id, COUNT(*) AS enrolled FROM enrollments_gare e JOIN users u ON u.id = e.user_id " +
            "WHERE e.gara_id IN (?) AND u.ruolo <> 'ADMIN' GROUP BY e.gara_id", [raceIds]
        ) : []
    ]);
    // admins: Numero degli amministratori da includere nel conteggio dei partecipanti.
    const admins = Number(counts[0]?.admins || 0);
    // courseById: Indicizza i corsi per identificativo per evitare ricerche ripetute.
    // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
    // Riceve: course (dati del corso).
    const courseById = new Map(courses.map(course => [Number(course.id), course]));
    // raceById: Associa ogni gara al relativo conteggio degli iscritti.
    // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
    // Riceve: race (dati della gara).
    const raceById = new Map(races.map(race => [Number(race.id), Number(race.enrolled)]));
    // managedCourseIds: Insieme dei corsi gestiti dal coach corrente.
    const managedCourseIds = new Set(courses
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: course (dati del corso).
        .filter(course => Number(course.coach_id) === Number(user.id))
        // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
        // Riceve: course (dati del corso).
        .map(course => Number(course.id)));

    // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
    // Riceve: stanza (dati della stanza).
    return stanze.map(stanza => {
        // participantsCount: Numero dei partecipanti calcolato per la stanza corrente.
        let participantsCount = 2;
        if (stanza.tipo === 'general') participantsCount = Number(counts[0]?.total || 0);
        if (stanza.tipo === 'corso') {
            // course: Dati del corso corrente.
            const course = courseById.get(getRoomNumericId(stanza.room_id, 'corso'));
            participantsCount = admins + Number(course?.enrolled || 0) + Number(course?.coach_extra || 0);
        }
        if (stanza.tipo === 'gara') participantsCount = admins + (raceById.get(getRoomNumericId(stanza.room_id, 'gara')) || 0);

        return {
            ...stanza,
            participants_count: participantsCount,
            can_delete_messages: utentePuoEliminareMessaggiStanza(stanza, user, managedCourseIds)
        };
    });
}

// Gestisce la rotta GET /profilo e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.get('/profilo', requireAuth, (req, res) => {
    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = req.session.utenteLoggato.id;

    // queryUtente: Query SQL che legge i dati del profilo autenticato.
    const queryUtente = `
        SELECT id, email, nome, cognome, ruolo, eta, bio, propic, certificato_scadenza
        FROM users
        WHERE id = ?
    `;
    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: errUser (errore della query sul profilo); resultsUser (righe del profilo).
    db.query(queryUtente, [userId], (errUser, resultsUser) => {
        if (errUser || resultsUser.length === 0) return res.status(500).json({ errore: 'Errore recupero utente' });
        
        // utenteAggiornato: Valore della proprietà resultsUser.0, conservato per le operazioni successive.
        const utenteAggiornato = resultsUser[0];

        // queryCorsi: Query SQL che recupera le iscrizioni ai corsi dell’utente.
        const queryCorsi = `
            SELECT corsi.id, corsi.nome, corsi.giorno, corsi.orario_inizio, corsi.durata
            FROM enrollments_corsi JOIN corsi ON enrollments_corsi.corso_id = corsi.id
            WHERE enrollments_corsi.user_id = ?
        `;
        // Riceve l’esito della query a callback e gestisce errore o righe restituite.
        // Riceve: err (errore intercettato); resultsCorsi (righe delle iscrizioni ai corsi).
        db.query(queryCorsi, [userId], (err, resultsCorsi) => {
            if (err) return res.status(500).json({ errore: 'Errore recupero corsi' });

            // queryGare: Query SQL che recupera le iscrizioni alle gare dell’utente.
            const queryGare = `
                SELECT gare.id, gare.nome, gare.giorno, gare.orario
                FROM enrollments_gare JOIN gare ON enrollments_gare.gara_id = gare.id
                WHERE enrollments_gare.user_id = ?
            `;
            // Riceve l’esito della query a callback e gestisce errore o righe restituite.
            // Riceve: err2 (errore della query successiva); resultsGare (righe delle iscrizioni alle gare).
            db.query(queryGare, [userId], (err2, resultsGare) => {
                if (err2) return res.status(500).json({ errore: 'Errore recupero gare' });

                res.json({ 
                    utente: utenteAggiornato, 
                    iscrizioni: resultsCorsi, 
                    iscrizioni_gare: resultsGare 
                });
            });
        });
    });
});

// Gestisce la rotta PUT /profilo/dati e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.put('/profilo/dati', requireAuth, (req, res) => {
    // validation: Esito della validazione: contiene i dati normalizzati oppure un errore.
    const validation = validateUserUpdate(req.body);
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (validation.error) return res.status(400).json({ errore: validation.error });

    // nome: Nome letto o normalizzato per il profilo o il form.
    // cognome: Cognome letto o normalizzato per il profilo.
    // eta: Valore della proprietà validation.value, conservato per le operazioni successive.
    // bio: Valore della proprietà validation.value, conservato per le operazioni successive.
    const { nome, cognome, eta, bio } = validation.value;
    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = req.session.utenteLoggato.id;

    // query: Istruzione SQL con cui leggere o modificare i record previsti.
    const query = 'UPDATE users SET nome = ?, cognome = ?, eta = ?, bio = ? WHERE id = ?';
    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato); result (esito dell’operazione).
    db.query(query, [nome, cognome, eta, bio, userId], (err, result) => {
        if (err) return res.status(500).json({ errore: 'Errore salvataggio' });
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Utente non trovato.' });
        req.session.utenteLoggato.nome = nome;
        req.session.utenteLoggato.cognome = cognome;
        req.session.utenteLoggato.eta = eta;
        req.session.utenteLoggato.bio = bio; 
        res.json({ messaggio: 'Dati aggiornati.' });
    });
});

// Gestisce la rotta POST /profilo/propic e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.post('/profilo/propic', requireAuth, uploadProfilo, async (req, res) => {
    if (!req.file) return res.status(400).json({ errore: 'Nessun file caricato.' });

    // nomeFile: Valore della proprietà req.file.filename, conservato per le operazioni successive.
    const nomeFile = req.file.filename;
    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = req.session.utenteLoggato.id;

    try {
        // utenti: Dati restituiti dal database al completamento della query.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const utenti = await queryAsync('SELECT propic FROM users WHERE id = ? LIMIT 1', [userId]);
        if (utenti.length === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Utente non trovato.' });
        }

        // vecchiaFoto: Valore della proprietà utenti.0.propic, conservato per le operazioni successive.
        const vecchiaFoto = utenti[0].propic;
        // result: Dati restituiti dal database al completamento della query.
        // Aggiorna i record individuati dalle condizioni della query; i segnaposto ? ricevono i valori separati dai
        // parametri.
        const result = await queryAsync('UPDATE users SET propic = ? WHERE id = ?', [nomeFile, userId]);
        if (result.affectedRows === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Utente non trovato.' });
        }

        req.session.utenteLoggato.propic = nomeFile; 
        removeUploadedFileIfUnused(vecchiaFoto, db);
        res.json({ messaggio: 'Foto aggiornata!', propic: nomeFile });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        removeUploadedFile(req.file);
        console.error('Errore aggiornamento foto profilo:', error.code || error.message);
        res.status(500).json({ errore: 'Errore database.' });
    }
});

// Gestisce la rotta POST /iscriviti e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.post('/iscriviti', (req, res) => {
    // Se il controllo non permette l’accesso, termina la richiesta con lo stato HTTP indicato.
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Devi accedere.' });
    // corsoId: Identificativo del corso interessato.
    const corsoId = parsePositiveId(req.body.corso_id);
    if (!corsoId) return res.status(400).json({ errore: 'Corso non valido.' });

    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato).
    db.query('INSERT INTO enrollments_corsi (user_id, corso_id) VALUES (?, ?)', [req.session.utenteLoggato.id, corsoId], (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ errore: 'Sei già iscritto.' });
            if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ errore: 'Corso non trovato.' });
            return res.status(500).json({ errore: 'Errore database.' });
        }
        res.json({ messaggio: 'Iscritto!' });
    });
});

// Gestisce la rotta POST /disiscriviti e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.post('/disiscriviti', (req, res) => {
    // Se il controllo non permette l’accesso, termina la richiesta con lo stato HTTP indicato.
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Devi accedere.' });
    // corsoId: Identificativo del corso interessato.
    const corsoId = parsePositiveId(req.body.corso_id);
    if (!corsoId) return res.status(400).json({ errore: 'Corso non valido.' });

    // Elimina i record individuati dalle condizioni della query; i segnaposto ? ricevono i valori separati dai
    // parametri.
    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato); result (esito dell’operazione).
    db.query('DELETE FROM enrollments_corsi WHERE user_id = ? AND corso_id = ?', [req.session.utenteLoggato.id, corsoId], (err, result) => {
        if (err) return res.status(500).json({ errore: 'Errore database.' });
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Iscrizione non trovata.' });
        res.json({ messaggio: 'Disiscritto.' });
    });
});

// Gestisce la rotta POST /iscriviti-gara e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.post('/iscriviti-gara', (req, res) => {
    // Se il controllo non permette l’accesso, termina la richiesta con lo stato HTTP indicato.
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Devi accedere.' });
    // garaId: Identificativo della gara interessata.
    const garaId = parsePositiveId(req.body.gara_id);
    if (!garaId) return res.status(400).json({ errore: 'Gara non valida.' });

    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato).
    db.query('INSERT INTO enrollments_gare (user_id, gara_id) VALUES (?, ?)', [req.session.utenteLoggato.id, garaId], (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ errore: 'Sei già iscritto.' });
            if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ errore: 'Gara non trovata.' });
            return res.status(500).json({ errore: 'Errore database.' });
        }
        res.json({ messaggio: 'Iscritto!' });
    });
});

// Gestisce la rotta POST /disiscriviti-gara e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.post('/disiscriviti-gara', (req, res) => {
    // Se il controllo non permette l’accesso, termina la richiesta con lo stato HTTP indicato.
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Devi accedere.' });
    // garaId: Identificativo della gara interessata.
    const garaId = parsePositiveId(req.body.gara_id);
    if (!garaId) return res.status(400).json({ errore: 'Gara non valida.' });

    // Elimina i record individuati dalle condizioni della query; i segnaposto ? ricevono i valori separati dai
    // parametri.
    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato); result (esito dell’operazione).
    db.query('DELETE FROM enrollments_gare WHERE user_id = ? AND gara_id = ?', [req.session.utenteLoggato.id, garaId], (err, result) => {
        if (err) return res.status(500).json({ errore: 'Errore database.' });
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Iscrizione non trovata.' });
        res.json({ messaggio: 'Ritirato.' });
    });
});

// Gestisce la rotta POST /chat/upload e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.post('/chat/upload', requireAuth, requireChatUploadAccess, uploadChat, (req, res) => {
    if (!req.file) return res.status(400).json({ errore: 'Nessun file caricato.' });
    // room: Identificativo della stanza su cui opera questo blocco.
    const room = req.chatUploadRoom.room;
    // uploadToken: Token di upload ricevuto dal client per autorizzare il riferimento al file.
    const uploadToken = createChatUploadToken({
        filename: req.file.filename,
        mimetype: req.file.mimetype,
        userId: req.session.utenteLoggato.id,
        room
    });
    programmaPuliziaUploadChat(req.file.filename);
    res.json({
        messaggio: 'File caricato',
        file_url: req.file.filename,
        file_type: req.file.mimetype,
        upload_token: uploadToken
    });
});

// Gestisce la rotta GET /chat/contatti e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.get('/chat/contatti', (req, res) => {
    // Se il controllo non permette l’accesso, termina la richiesta con lo stato HTTP indicato.
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Non autorizzato.' });
    // user: Dati dell’utente coinvolto in questo blocco.
    const user = req.session.utenteLoggato;
    // query: Istruzione SQL con cui leggere o modificare i record previsti.
    const query = (user.ruolo === 'ADMIN' || user.ruolo === 'COACH') 
        ? 'SELECT id, nome, cognome, ruolo, propic FROM users WHERE id != ? ORDER BY nome ASC' 
        : 'SELECT id, nome, cognome, ruolo, propic FROM users WHERE id != ? AND ruolo IN ("ADMIN", "COACH") ORDER BY nome ASC';
    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato); results (risultati dell’operazione).
    db.query(query, [user.id], (err, results) => {
        if (err) return res.status(500).json({ errore: 'Errore recupero contatti' });
        res.json(results);
    });
});

// Gestisce la rotta POST /chat/private/:id e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.post('/chat/private/:id', requireAuth, async (req, res) => {
    // user: Dati dell’utente coinvolto in questo blocco.
    const user = req.session.utenteLoggato;
    // peerId: Valore convertito o normalizzato prima del suo utilizzo.
    const peerId = parsePositiveId(req.params.id);
    // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
    const stanza = peerId && normalizeChatRoom('private_' + Math.min(user.id, peerId) + '_' + Math.max(user.id, peerId));
    if (!stanza || !await utentePuoAccedereAStanza(user, stanza.room)) {
        return res.status(404).json({ errore: 'Conversazione non disponibile.' });
    }
    await salvaChatPrivata(stanza);
    res.json({ room: stanza.room });
});

// Gestisce la rotta GET /chat/stanze e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.get('/chat/stanze', (req, res) => {
    // Se il controllo non permette l’accesso, termina la richiesta con lo stato HTTP indicato.
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Non autorizzato.' });
    // user: Dati dell’utente coinvolto in questo blocco.
    const user = req.session.utenteLoggato;

    // baseQuery: Testo o valore iniziale utilizzato da questo blocco.
    let baseQuery = '';
    // params: Valori separati dall’istruzione SQL e associati ai suoi segnaposto.
    let params = [];

    if (user.ruolo === 'ADMIN') {
        baseQuery = `
            SELECT CONCAT('corso_', id) AS room_id, nome, 'corso' AS tipo, propic AS immagine, bio AS descrizione, NULL AS ruolo, NULL AS eta FROM corsi 
            UNION 
            SELECT CONCAT('gara_', id) AS room_id, nome, 'gara' AS tipo, propic AS immagine, bio AS descrizione, NULL AS ruolo, NULL AS eta FROM gare`;
    } else if (user.ruolo === 'COACH') {
        baseQuery = `
            SELECT CONCAT('corso_', id) AS room_id, nome, 'corso' AS tipo, propic AS immagine, bio AS descrizione, NULL AS ruolo, NULL AS eta FROM corsi WHERE coach_id = ? 
            UNION 
            SELECT CONCAT('corso_', c.id) AS room_id, c.nome, 'corso' AS tipo, c.propic AS immagine, c.bio AS descrizione, NULL AS ruolo, NULL AS eta FROM corsi c JOIN enrollments_corsi ec ON c.id = ec.corso_id WHERE ec.user_id = ? 
            UNION 
            SELECT CONCAT('gara_', g.id) AS room_id, g.nome, 'gara' AS tipo, g.propic AS immagine, g.bio AS descrizione, NULL AS ruolo, NULL AS eta FROM gare g JOIN enrollments_gare eg ON g.id = eg.gara_id WHERE eg.user_id = ?`;
        params = [user.id, user.id, user.id];
    } else {
        baseQuery = `
            SELECT CONCAT('corso_', c.id) AS room_id, c.nome, 'corso' AS tipo, c.propic AS immagine, c.bio AS descrizione, NULL AS ruolo, NULL AS eta FROM corsi c JOIN enrollments_corsi ec ON c.id = ec.corso_id WHERE ec.user_id = ? 
            UNION 
            SELECT CONCAT('gara_', g.id) AS room_id, g.nome, 'gara' AS tipo, g.propic AS immagine, g.bio AS descrizione, NULL AS ruolo, NULL AS eta FROM gare g JOIN enrollments_gare eg ON g.id = eg.gara_id WHERE eg.user_id = ?`;
        params = [user.id, user.id];
    }

    // privateQuery: Query SQL che ricostruisce l’elenco delle conversazioni private.
    const privateQuery = `
        SELECT CONCAT('private_', p.first_user_id, '_', p.second_user_id) AS room_id, CONCAT(u.nome, ' ', u.cognome) AS nome,
            'private' AS tipo, u.propic AS immagine, u.bio AS descrizione, u.ruolo AS ruolo, u.eta AS eta
        FROM private_conversations p
        JOIN users u ON u.id = IF(p.first_user_id = ?, p.second_user_id, p.first_user_id)
        WHERE (p.first_user_id = ? OR p.second_user_id = ?)
            AND (? IN ('ADMIN', 'COACH') OR u.ruolo IN ('ADMIN', 'COACH'))
    `;

    // fullQuery: Query SQL finale utilizzata per recuperare i dati delle stanze.
    const fullQuery = `
        SELECT
            stanze.room_id,
            stanze.nome,
            stanze.tipo,
            stanze.immagine,
            stanze.descrizione,
            stanze.ruolo,
            stanze.eta,
            MAX(m.data_invio) AS last_msg_time,
            (
                SELECT CASE
                    WHEN msg.file_url IS NOT NULL AND (msg.contenuto IS NULL OR msg.contenuto = '') THEN 'Allegato'
                    ELSE msg.contenuto
                END
                FROM messages msg
                WHERE msg.room = stanze.room_id
                ORDER BY msg.data_invio DESC, msg.id DESC
                LIMIT 1
            ) AS last_message_preview
        FROM (
            SELECT 'general' AS room_id, 'Piazza principale' AS nome, 'general' AS tipo, NULL AS immagine, 'La piazza pubblica' AS descrizione, NULL AS ruolo, NULL AS eta
            UNION ${baseQuery} UNION ${privateQuery}
        ) AS stanze
        LEFT JOIN messages m ON m.room = stanze.room_id
        GROUP BY stanze.room_id, stanze.nome, stanze.tipo, stanze.immagine, stanze.descrizione, stanze.ruolo, stanze.eta
        ORDER BY CASE WHEN stanze.room_id = 'general' THEN 0 ELSE 1 END, last_msg_time DESC, stanze.nome ASC
    `;

    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato); results (risultati dell’operazione).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    db.query(fullQuery, [...params, user.id, user.id, user.id, user.ruolo], async (err, results) => {
        if (err) {
            console.error("Errore caricamento stanze chat:", err);
            return res.status(500).json({ errore: 'Errore caricamento stanze.' });
        }
        try {
            res.json(await preparaStanzeChat(results, user));
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            console.error("Errore conteggio partecipanti:", error);
            res.status(500).json({ errore: 'Errore conteggio partecipanti.' });
        }
    });
});

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = router;
