const express = require('express');
const { createHmac } = require('node:crypto');
const router = express.Router();
const db = require('../config/db');
const { uploadProfilo, uploadChat } = require('../config/upload');
const { salvaChatPrivata, utentePuoAccedereAStanza } = require('../utils/chat-access');
const {
    CHAT_UPLOAD_TOKEN_TTL_MS,
    createChatUploadToken,
    removeUploadedFile,
    removeUploadedFileIfUnused
} = require('../utils/file-security');
const {
    normalizeChatRoom
} = require('../utils/socket-security');
const {
    parsePositiveId,
    validateUserUpdate
} = require('../utils/validation');

function requireAuth(req, res, next) {
    if (!req.session.utenteLoggato) {
        return res.status(401).json({ errore: 'Devi accedere.' });
    }
    next();
}

router.get('/chiamate/ice', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const urls = (process.env.TURN_URLS || '').split(',')
        .map(url => url.trim())
        .filter(url => /^turns?:[^\s]+$/i.test(url));
    const secret = process.env.TURN_SHARED_SECRET;
    if (!urls.length || !secret) return res.json({ iceServers: [] });

    const expiresAt = Math.floor(Date.now() / 1000) + 4 * 60 * 60;
    const username = expiresAt + ':' + req.session.utenteLoggato.id;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    res.json({ iceServers: [{ urls, username, credential }] });
});

function queryAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, results) => {
            if (error) reject(error);
            else resolve(results);
        });
    });
}

function getRoomNumericId(roomId, prefix) {
    const match = new RegExp(`^${prefix}_(\\d+)$`).exec(roomId || '');
    return match ? Number(match[1]) : null;
}

async function requireChatUploadAccess(req, res, next) {
    const stanza = normalizeChatRoom(req.query.room);
    if (!stanza) return res.status(400).json({ errore: 'Stanza chat non valida.' });

    try {
        if (!await utentePuoAccedereAStanza(req.session.utenteLoggato, stanza.room)) {
            return res.status(403).json({ errore: 'Non hai i permessi per caricare file in questa chat.' });
        }
        req.chatUploadRoom = stanza;
        next();
    } catch (error) {
        console.error('Errore autorizzazione upload chat:', error.code || error.message);
        res.status(500).json({ errore: 'Errore autorizzazione upload.' });
    }
}

function programmaPuliziaUploadChat(filename) {
    const timer = setTimeout(() => {
        removeUploadedFileIfUnused(filename, db);
    }, CHAT_UPLOAD_TOKEN_TTL_MS + 30 * 1000);

    if (typeof timer.unref === 'function') timer.unref();
}

function utentePuoEliminareMessaggiStanza(stanza, user, managedCourseIds) {
    const ruolo = String(user.ruolo || '').toUpperCase();
    if (ruolo === 'ADMIN') return true;
    if (ruolo !== 'COACH') return false;

    if (stanza.tipo === 'private') return true;
    if (stanza.tipo !== 'corso') return false;

    const courseId = getRoomNumericId(stanza.room_id, 'corso');
    return managedCourseIds.has(courseId);
}

async function preparaStanzeChat(stanze, user) {
    const courseIds = stanze.filter(stanza => stanza.tipo === 'corso').map(stanza => getRoomNumericId(stanza.room_id, 'corso'));
    const raceIds = stanze.filter(stanza => stanza.tipo === 'gara').map(stanza => getRoomNumericId(stanza.room_id, 'gara'));
    const [counts, courses, races] = await Promise.all([
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
    const admins = Number(counts[0]?.admins || 0);
    const courseById = new Map(courses.map(course => [Number(course.id), course]));
    const raceById = new Map(races.map(race => [Number(race.id), Number(race.enrolled)]));
    const managedCourseIds = new Set(courses
        .filter(course => Number(course.coach_id) === Number(user.id))
        .map(course => Number(course.id)));

    return stanze.map(stanza => {
        let participantsCount = 2;
        if (stanza.tipo === 'general') participantsCount = Number(counts[0]?.total || 0);
        if (stanza.tipo === 'corso') {
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

router.get('/profilo', requireAuth, (req, res) => {
    const userId = req.session.utenteLoggato.id;

    const queryUtente = `
        SELECT id, email, nome, cognome, ruolo, eta, bio, propic, certificato_scadenza
        FROM users
        WHERE id = ?
    `;
    db.query(queryUtente, [userId], (errUser, resultsUser) => {
        if (errUser || resultsUser.length === 0) return res.status(500).json({ errore: 'Errore recupero utente' });
        
        const utenteAggiornato = resultsUser[0];

        const queryCorsi = `
            SELECT corsi.id, corsi.nome, corsi.giorno, corsi.orario_inizio, corsi.durata
            FROM enrollments_corsi JOIN corsi ON enrollments_corsi.corso_id = corsi.id
            WHERE enrollments_corsi.user_id = ?
        `;
        db.query(queryCorsi, [userId], (err, resultsCorsi) => {
            if (err) return res.status(500).json({ errore: 'Errore recupero corsi' });

            const queryGare = `
                SELECT gare.id, gare.nome, gare.giorno, gare.orario
                FROM enrollments_gare JOIN gare ON enrollments_gare.gara_id = gare.id
                WHERE enrollments_gare.user_id = ?
            `;
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

router.put('/profilo/dati', requireAuth, (req, res) => {
    const validation = validateUserUpdate(req.body);
    if (validation.error) return res.status(400).json({ errore: validation.error });

    const { nome, cognome, eta, bio } = validation.value;
    const userId = req.session.utenteLoggato.id;

    const query = 'UPDATE users SET nome = ?, cognome = ?, eta = ?, bio = ? WHERE id = ?';
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

router.post('/profilo/propic', requireAuth, uploadProfilo, async (req, res) => {
    if (!req.file) return res.status(400).json({ errore: 'Nessun file caricato.' });

    const nomeFile = req.file.filename;
    const userId = req.session.utenteLoggato.id;

    try {
        const utenti = await queryAsync('SELECT propic FROM users WHERE id = ? LIMIT 1', [userId]);
        if (utenti.length === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Utente non trovato.' });
        }

        const vecchiaFoto = utenti[0].propic;
        const result = await queryAsync('UPDATE users SET propic = ? WHERE id = ?', [nomeFile, userId]);
        if (result.affectedRows === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Utente non trovato.' });
        }

        req.session.utenteLoggato.propic = nomeFile; 
        removeUploadedFileIfUnused(vecchiaFoto, db);
        res.json({ messaggio: 'Foto aggiornata!', propic: nomeFile });
    } catch (error) {
        removeUploadedFile(req.file);
        console.error('Errore aggiornamento foto profilo:', error.code || error.message);
        res.status(500).json({ errore: 'Errore database.' });
    }
});

router.post('/iscriviti', (req, res) => {
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Devi accedere.' });
    const corsoId = parsePositiveId(req.body.corso_id);
    if (!corsoId) return res.status(400).json({ errore: 'Corso non valido.' });

    db.query('INSERT INTO enrollments_corsi (user_id, corso_id) VALUES (?, ?)', [req.session.utenteLoggato.id, corsoId], (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ errore: 'Sei già iscritto.' });
            if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ errore: 'Corso non trovato.' });
            return res.status(500).json({ errore: 'Errore database.' });
        }
        res.json({ messaggio: 'Iscritto!' });
    });
});

router.post('/disiscriviti', (req, res) => {
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Devi accedere.' });
    const corsoId = parsePositiveId(req.body.corso_id);
    if (!corsoId) return res.status(400).json({ errore: 'Corso non valido.' });

    db.query('DELETE FROM enrollments_corsi WHERE user_id = ? AND corso_id = ?', [req.session.utenteLoggato.id, corsoId], (err, result) => {
        if (err) return res.status(500).json({ errore: 'Errore database.' });
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Iscrizione non trovata.' });
        res.json({ messaggio: 'Disiscritto.' });
    });
});

router.post('/iscriviti-gara', (req, res) => {
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Devi accedere.' });
    const garaId = parsePositiveId(req.body.gara_id);
    if (!garaId) return res.status(400).json({ errore: 'Gara non valida.' });

    db.query('INSERT INTO enrollments_gare (user_id, gara_id) VALUES (?, ?)', [req.session.utenteLoggato.id, garaId], (err) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ errore: 'Sei già iscritto.' });
            if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ errore: 'Gara non trovata.' });
            return res.status(500).json({ errore: 'Errore database.' });
        }
        res.json({ messaggio: 'Iscritto!' });
    });
});

router.post('/disiscriviti-gara', (req, res) => {
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Devi accedere.' });
    const garaId = parsePositiveId(req.body.gara_id);
    if (!garaId) return res.status(400).json({ errore: 'Gara non valida.' });

    db.query('DELETE FROM enrollments_gare WHERE user_id = ? AND gara_id = ?', [req.session.utenteLoggato.id, garaId], (err, result) => {
        if (err) return res.status(500).json({ errore: 'Errore database.' });
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Iscrizione non trovata.' });
        res.json({ messaggio: 'Ritirato.' });
    });
});

router.post('/chat/upload', requireAuth, requireChatUploadAccess, uploadChat, (req, res) => {
    if (!req.file) return res.status(400).json({ errore: 'Nessun file caricato.' });
    const room = req.chatUploadRoom.room;
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

router.get('/chat/contatti', (req, res) => {
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Non autorizzato.' });
    const user = req.session.utenteLoggato;
    const query = (user.ruolo === 'ADMIN' || user.ruolo === 'COACH') 
        ? 'SELECT id, nome, cognome, ruolo, propic FROM users WHERE id != ? ORDER BY nome ASC' 
        : 'SELECT id, nome, cognome, ruolo, propic FROM users WHERE id != ? AND ruolo IN ("ADMIN", "COACH") ORDER BY nome ASC';
    db.query(query, [user.id], (err, results) => {
        if (err) return res.status(500).json({ errore: 'Errore recupero contatti' });
        res.json(results);
    });
});

router.post('/chat/private/:id', requireAuth, async (req, res) => {
    const user = req.session.utenteLoggato;
    const peerId = parsePositiveId(req.params.id);
    const stanza = peerId && normalizeChatRoom('private_' + Math.min(user.id, peerId) + '_' + Math.max(user.id, peerId));
    if (!stanza || !await utentePuoAccedereAStanza(user, stanza.room)) {
        return res.status(404).json({ errore: 'Conversazione non disponibile.' });
    }
    await salvaChatPrivata(stanza);
    res.json({ room: stanza.room });
});

router.get('/chat/stanze', (req, res) => {
    if (!req.session.utenteLoggato) return res.status(401).json({ errore: 'Non autorizzato.' });
    const user = req.session.utenteLoggato;

    let baseQuery = '';
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

    const privateQuery = `
        SELECT CONCAT('private_', p.first_user_id, '_', p.second_user_id) AS room_id, CONCAT(u.nome, ' ', u.cognome) AS nome,
            'private' AS tipo, u.propic AS immagine, u.bio AS descrizione, u.ruolo AS ruolo, u.eta AS eta
        FROM private_conversations p
        JOIN users u ON u.id = IF(p.first_user_id = ?, p.second_user_id, p.first_user_id)
        WHERE (p.first_user_id = ? OR p.second_user_id = ?)
            AND (? IN ('ADMIN', 'COACH') OR u.ruolo IN ('ADMIN', 'COACH'))
    `;

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

    db.query(fullQuery, [...params, user.id, user.id, user.id, user.ruolo], async (err, results) => {
        if (err) {
            console.error("Errore caricamento stanze chat:", err);
            return res.status(500).json({ errore: 'Errore caricamento stanze.' });
        }
        try {
            res.json(await preparaStanzeChat(results, user));
        } catch (error) {
            console.error("Errore conteggio partecipanti:", error);
            res.status(500).json({ errore: 'Errore conteggio partecipanti.' });
        }
    });
});

module.exports = router;
