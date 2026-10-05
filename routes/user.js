const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { uploadProfilo, uploadChat } = require('../config/upload');
const {
    CHAT_UPLOAD_TOKEN_TTL_MS,
    createChatUploadToken,
    removeUploadedFile,
    removeUploadedFileIfUnused
} = require('../utils/file-security');
const {
    getPrivateRoomPeer,
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

async function utentePuoAccedereAStanza(user, room) {
    const userId = parsePositiveId(user?.id);
    const ruolo = String(user?.ruolo || '').toUpperCase();
    const stanza = normalizeChatRoom(room);
    if (!userId || !stanza) return false;
    if (stanza.type === 'general') return true;

    if (stanza.type === 'private') {
        if (!stanza.userIds.includes(userId)) return false;

        const otherId = getPrivateRoomPeer(stanza.room, userId);
        if (!otherId) return false;

        const users = await queryAsync(
            'SELECT id, ruolo FROM users WHERE id = ? LIMIT 1',
            [otherId]
        );
        if (users.length === 0) return false;
        if (ruolo === 'ADMIN' || ruolo === 'COACH') return true;
        return ['ADMIN', 'COACH'].includes(String(users[0].ruolo || '').toUpperCase());
    }

    if (stanza.type === 'corso') {
        if (ruolo === 'ADMIN') {
            const rows = await queryAsync('SELECT id FROM corsi WHERE id = ? LIMIT 1', [stanza.id]);
            return rows.length > 0;
        }

        const rows = await queryAsync(`
            SELECT c.id
            FROM corsi c
            LEFT JOIN enrollments_corsi ec ON ec.corso_id = c.id AND ec.user_id = ?
            WHERE c.id = ? AND (c.coach_id = ? OR ec.user_id IS NOT NULL)
            LIMIT 1
        `, [userId, stanza.id, userId]);

        return rows.length > 0;
    }

    if (stanza.type === 'gara') {
        if (ruolo === 'ADMIN') {
            const rows = await queryAsync('SELECT id FROM gare WHERE id = ? LIMIT 1', [stanza.id]);
            return rows.length > 0;
        }

        const rows = await queryAsync(
            'SELECT gara_id FROM enrollments_gare WHERE gara_id = ? AND user_id = ? LIMIT 1',
            [stanza.id, userId]
        );
        return rows.length > 0;
    }

    return false;
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
    const [
        totalUsersRows,
        adminRows,
        courseRows,
        courseEnrollmentRows,
        raceEnrollmentRows
    ] = await Promise.all([
        queryAsync('SELECT COUNT(*) AS total FROM users'),
        queryAsync('SELECT id FROM users WHERE ruolo = "ADMIN"'),
        queryAsync('SELECT id, coach_id FROM corsi'),
        queryAsync('SELECT corso_id, user_id FROM enrollments_corsi'),
        queryAsync('SELECT gara_id, user_id FROM enrollments_gare')
    ]);

    const totalUsers = Number(totalUsersRows[0]?.total || 0);
    const userId = Number(user.id);
    const adminIds = new Set(adminRows.map(row => Number(row.id)).filter(Boolean));
    const courseParticipants = new Map();
    const raceParticipants = new Map();
    const managedCourseIds = new Set(
        courseRows
            .filter(course => Number(course.coach_id) === userId)
            .map(course => Number(course.id))
    );

    courseRows.forEach(course => {
        const participants = new Set(adminIds);
        if (course.coach_id) participants.add(Number(course.coach_id));
        courseParticipants.set(Number(course.id), participants);
    });

    courseEnrollmentRows.forEach(enrollment => {
        const courseId = Number(enrollment.corso_id);
        if (!courseParticipants.has(courseId)) courseParticipants.set(courseId, new Set(adminIds));
        courseParticipants.get(courseId).add(Number(enrollment.user_id));
    });

    raceEnrollmentRows.forEach(enrollment => {
        const raceId = Number(enrollment.gara_id);
        if (!raceParticipants.has(raceId)) raceParticipants.set(raceId, new Set(adminIds));
        raceParticipants.get(raceId).add(Number(enrollment.user_id));
    });

    return stanze.map(stanza => {
        let participantsCount = 0;

        if (stanza.tipo === 'private') {
            participantsCount = 2;
        } else if (stanza.tipo === 'general') {
            participantsCount = totalUsers;
        } else if (stanza.tipo === 'corso') {
            const courseId = getRoomNumericId(stanza.room_id, 'corso');
            participantsCount = courseParticipants.get(courseId)?.size || adminIds.size;
        } else if (stanza.tipo === 'gara') {
            const raceId = getRoomNumericId(stanza.room_id, 'gara');
            participantsCount = raceParticipants.get(raceId)?.size || adminIds.size;
        }

        return {
            ...stanza,
            participants_count: Math.max(0, participantsCount),
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
        SELECT DISTINCT m.room AS room_id, CONCAT(u.nome, ' ', u.cognome) AS nome, 'private' AS tipo, u.propic AS immagine, u.bio AS descrizione, u.ruolo AS ruolo, u.eta AS eta 
        FROM messages m JOIN users u ON (m.room = CONCAT('private_', ?, '_', u.id) OR m.room = CONCAT('private_', u.id, '_', ?))
        WHERE m.room LIKE 'private_%' AND u.id != ?
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

    db.query(fullQuery, [...params, user.id, user.id, user.id], async (err, results) => {
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
