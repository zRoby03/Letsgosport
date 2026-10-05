const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { uploadCopertina } = require('../config/upload');
const {
    removeUploadedFile,
    removeUploadedFileIfUnused
} = require('../utils/file-security');
const {
    parsePositiveId,
    validateAdminUserUpdate,
    validateCourse,
    validateRace
} = require('../utils/validation');

function checkAdmin(req, res, next) {
    if (!req.session.utenteLoggato || req.session.utenteLoggato.ruolo !== 'ADMIN') {
        return res.status(403).json({ errore: 'Accesso negato. Area riservata.' });
    }
    next();
}

function parseRouteId(req, res) {
    const id = parsePositiveId(req.params.id);
    if (!id) {
        res.status(400).json({ errore: 'Identificativo non valido.' });
        return null;
    }
    return id;
}

function queryAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, results) => {
            if (error) reject(error);
            else resolve(results);
        });
    });
}

function ensureAssignableCoach(coachId, callback) {
    if (!coachId) return callback(null);

    db.query(
        "SELECT id FROM users WHERE id = ? AND ruolo IN ('ADMIN', 'COACH') LIMIT 1",
        [coachId],
        (error, results) => {
            if (error) return callback(error);
            if (results.length === 0) {
                const validationError = new Error('Coach non valido.');
                validationError.status = 400;
                return callback(validationError);
            }
            callback(null);
        }
    );
}

function ensureAssignableCoachAsync(coachId) {
    return new Promise((resolve, reject) => {
        ensureAssignableCoach(coachId, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function handleWriteError(res, error, fallbackMessage, uploadedFile) {
    if (uploadedFile) removeUploadedFile(uploadedFile);
    const status = error?.status || 500;
    return res.status(status).json({
        errore: status === 500 ? fallbackMessage : error.message
    });
}

router.use(checkAdmin);

router.get('/utenti', (req, res) => {
    db.query(
        'SELECT id, nome, cognome, email, eta, ruolo, bio, propic, certificato_scadenza FROM users ORDER BY id DESC',
        (error, results) => {
            if (error) return res.status(500).json({ errore: 'Errore nel caricamento utenti.' });
            res.json(results);
        }
    );
});

router.put('/utenti/:id', (req, res) => {
    const userId = parseRouteId(req, res);
    if (!userId) return;

    const validation = validateAdminUserUpdate(req.body);
    if (validation.error) return res.status(400).json({ errore: validation.error });

    const {
        nome,
        cognome,
        eta,
        ruolo,
        bio,
        certificato_scadenza
    } = validation.value;

    const query = `
        UPDATE users
        SET nome = ?, cognome = ?, eta = ?, ruolo = ?, bio = ?, certificato_scadenza = ?
        WHERE id = ?
    `;
    db.query(
        query,
        [nome, cognome, eta, ruolo, bio, certificato_scadenza, userId],
        (error, result) => {
            if (error) return res.status(500).json({ errore: 'Errore nel salvataggio dati.' });
            if (result.affectedRows === 0) return res.status(404).json({ errore: 'Utente non trovato.' });

            if (userId !== Number(req.session.utenteLoggato.id)) {
                return res.json({ messaggio: 'Dati utente aggiornati.' });
            }

            Object.assign(req.session.utenteLoggato, {
                nome,
                cognome,
                eta,
                ruolo,
                bio,
                certificato_scadenza
            });
            req.session.save((sessionError) => {
                if (sessionError) {
                    return res.status(500).json({ errore: 'Dati aggiornati, ma sessione non sincronizzata.' });
                }
                res.json({ messaggio: 'Dati utente aggiornati.' });
            });
        }
    );
});

router.put('/utenti/:id/reset-propic', async (req, res) => {
    const userId = parseRouteId(req, res);
    if (!userId) return;

    try {
        const users = await queryAsync('SELECT propic FROM users WHERE id = ? LIMIT 1', [userId]);
        if (users.length === 0) return res.status(404).json({ errore: 'Utente non trovato.' });

        const oldImage = users[0].propic;
        const result = await queryAsync("UPDATE users SET propic = 'default_user.png' WHERE id = ?", [userId]);
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Utente non trovato.' });

        if (userId === Number(req.session.utenteLoggato.id)) {
            req.session.utenteLoggato.propic = 'default_user.png';
        }
        removeUploadedFileIfUnused(oldImage, db);
        res.json({ messaggio: 'Foto profilo rimossa.' });
    } catch (error) {
        console.error('Errore reset immagine:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante il reset immagine.' });
    }
});

router.delete('/utenti/:id', async (req, res) => {
    const userId = parseRouteId(req, res);
    if (!userId) return;
    if (userId === Number(req.session.utenteLoggato.id)) {
        return res.status(400).json({ errore: 'Non puoi cancellare il tuo stesso account.' });
    }

    try {
        const users = await queryAsync('SELECT propic FROM users WHERE id = ? LIMIT 1', [userId]);
        if (users.length === 0) return res.status(404).json({ errore: 'Utente non trovato.' });

        const attachments = await queryAsync(
            'SELECT file_url FROM messages WHERE user_id = ? AND file_url IS NOT NULL',
            [userId]
        );
        const result = await queryAsync('DELETE FROM users WHERE id = ?', [userId]);
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Utente non trovato.' });

        removeUploadedFileIfUnused(users[0].propic, db);
        attachments.forEach(row => removeUploadedFileIfUnused(row.file_url, db));
        res.json({ messaggio: 'Utente eliminato definitivamente.' });
    } catch (error) {
        console.error('Errore cancellazione utente:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante la cancellazione.' });
    }
});

router.post('/corsi', uploadCopertina, (req, res) => {
    const validation = validateCourse(req.body);
    if (validation.error) {
        removeUploadedFile(req.file);
        return res.status(400).json({ errore: validation.error });
    }

    const course = validation.value;
    const imageName = req.file ? req.file.filename : 'default_corso.png';
    ensureAssignableCoach(course.coach_id, (coachError) => {
        if (coachError) return handleWriteError(res, coachError, 'Errore durante la verifica del coach.', req.file);

        const query = `
            INSERT INTO corsi (nome, giorno, orario_inizio, durata, costo, bio, coach_id, propic)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.query(
            query,
            [
                course.nome,
                course.giorno,
                course.orario_inizio,
                course.durata,
                course.costo,
                course.bio,
                course.coach_id,
                imageName
            ],
            (error) => {
                if (error) return handleWriteError(res, error, 'Errore durante la creazione del corso.', req.file);
                res.json({ messaggio: 'Corso creato.' });
            }
        );
    });
});

router.put('/corsi/:id', uploadCopertina, async (req, res) => {
    const courseId = parseRouteId(req, res);
    if (!courseId) {
        removeUploadedFile(req.file);
        return;
    }

    const validation = validateCourse(req.body);
    if (validation.error) {
        removeUploadedFile(req.file);
        return res.status(400).json({ errore: validation.error });
    }

    const course = validation.value;
    try {
        await ensureAssignableCoachAsync(course.coach_id);
        const existingCourses = await queryAsync('SELECT propic FROM corsi WHERE id = ? LIMIT 1', [courseId]);
        if (existingCourses.length === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Corso non trovato.' });
        }

        const oldImage = existingCourses[0].propic;
        const imageFields = req.file ? ', propic = ?' : '';
        const query = `
            UPDATE corsi
            SET nome = ?, giorno = ?, orario_inizio = ?, durata = ?, costo = ?, bio = ?, coach_id = ?
            ${imageFields}
            WHERE id = ?
        `;
        const params = [
            course.nome,
            course.giorno,
            course.orario_inizio,
            course.durata,
            course.costo,
            course.bio,
            course.coach_id
        ];
        if (req.file) params.push(req.file.filename);
        params.push(courseId);

        const result = await queryAsync(query, params);
        if (result.affectedRows === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Corso non trovato.' });
        }

        if (req.file) removeUploadedFileIfUnused(oldImage, db);
        res.json({ messaggio: 'Corso modificato.' });
    } catch (error) {
        return handleWriteError(res, error, 'Errore durante la modifica del corso.', req.file);
    }
});

router.delete('/corsi/:id', async (req, res) => {
    const courseId = parseRouteId(req, res);
    if (!courseId) return;

    try {
        const existingCourses = await queryAsync('SELECT propic FROM corsi WHERE id = ? LIMIT 1', [courseId]);
        if (existingCourses.length === 0) return res.status(404).json({ errore: 'Corso non trovato.' });

        const result = await queryAsync('DELETE FROM corsi WHERE id = ?', [courseId]);
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Corso non trovato.' });

        removeUploadedFileIfUnused(existingCourses[0].propic, db);
        res.json({ messaggio: 'Corso eliminato.' });
    } catch (error) {
        console.error('Errore cancellazione corso:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante la cancellazione.' });
    }
});

router.post('/gare', uploadCopertina, (req, res) => {
    const validation = validateRace(req.body);
    if (validation.error) {
        removeUploadedFile(req.file);
        return res.status(400).json({ errore: validation.error });
    }

    const race = validation.value;
    const imageName = req.file ? req.file.filename : 'default_gara.png';
    db.query(
        'INSERT INTO gare (nome, giorno, orario, costo, bio, propic) VALUES (?, ?, ?, ?, ?, ?)',
        [race.nome, race.giorno, race.orario, race.costo, race.bio, imageName],
        (error) => {
            if (error) return handleWriteError(res, error, 'Errore durante la creazione della gara.', req.file);
            res.json({ messaggio: 'Gara creata.' });
        }
    );
});

router.put('/gare/:id', uploadCopertina, async (req, res) => {
    const raceId = parseRouteId(req, res);
    if (!raceId) {
        removeUploadedFile(req.file);
        return;
    }

    const validation = validateRace(req.body);
    if (validation.error) {
        removeUploadedFile(req.file);
        return res.status(400).json({ errore: validation.error });
    }

    const race = validation.value;
    try {
        const existingRaces = await queryAsync('SELECT propic FROM gare WHERE id = ? LIMIT 1', [raceId]);
        if (existingRaces.length === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Gara non trovata.' });
        }

        const oldImage = existingRaces[0].propic;
        const imageFields = req.file ? ', propic = ?' : '';
        const query = `
            UPDATE gare
            SET nome = ?, giorno = ?, orario = ?, costo = ?, bio = ?
            ${imageFields}
            WHERE id = ?
        `;
        const params = [race.nome, race.giorno, race.orario, race.costo, race.bio];
        if (req.file) params.push(req.file.filename);
        params.push(raceId);

        const result = await queryAsync(query, params);
        if (result.affectedRows === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Gara non trovata.' });
        }

        if (req.file) removeUploadedFileIfUnused(oldImage, db);
        res.json({ messaggio: 'Gara modificata.' });
    } catch (error) {
        return handleWriteError(res, error, 'Errore durante la modifica della gara.', req.file);
    }
});

router.delete('/gare/:id', async (req, res) => {
    const raceId = parseRouteId(req, res);
    if (!raceId) return;

    try {
        const existingRaces = await queryAsync('SELECT propic FROM gare WHERE id = ? LIMIT 1', [raceId]);
        if (existingRaces.length === 0) return res.status(404).json({ errore: 'Gara non trovata.' });

        const result = await queryAsync('DELETE FROM gare WHERE id = ?', [raceId]);
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Gara non trovata.' });

        removeUploadedFileIfUnused(existingRaces[0].propic, db);
        res.json({ messaggio: 'Gara eliminata.' });
    } catch (error) {
        console.error('Errore cancellazione gara:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante la cancellazione della gara.' });
    }
});

module.exports = router;
