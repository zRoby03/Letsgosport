// API amministrative montate sotto /api/admin: controlli di ruolo e operazioni su utenti, corsi e gare.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// express: Express definisce router, middleware e risposte HTTP.
const express = require('express');
// router: Router Express che raggruppa gli endpoint di questo modulo.
const router = express.Router();
// db: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece
// di aprirne una per richiesta.
const db = require('../config/db');
// uploadCopertina: Importa il modulo locale. Multer legge i form multipart; questo modulo controlla estensioni,
// MIME, firme dei file e salvataggio.
const { uploadCopertina } = require('../config/upload');
// deleteUserSessions: Elimina dal database le sessioni appartenenti all’utente indicato.
// hasCurrentRole: Confronta il ruolo nella sessione con quello attuale nel database; restituisce true solo se
// coincidono.
const { deleteUserSessions, hasCurrentRole } = require('../utils/session-access');
// removeUploadedFile: Rimuove un upload generato dall’applicazione; restituisce l’esito senza propagare errori di
// cancellazione.
// removeUploadedFileIfUnused: Cancella il file soltanto se è un upload riconosciuto e non risultano riferimenti
// nel database.
const {
    removeUploadedFile,
    removeUploadedFileIfUnused
} = require('../utils/file-security');
// parsePositiveId: Converte il valore in un identificativo intero positivo oppure restituisce null.
// validateAdminUserUpdate: Valida il profilo amministrativo, compresi ruolo e scadenza del certificato.
// validateCourse: Controlla i dati di un corso e restituisce i campi normalizzati oppure un errore.
// validateRace: Controlla i dati di una gara e restituisce i campi normalizzati oppure un errore.
const {
    parsePositiveId,
    validateAdminUserUpdate,
    validateCourse,
    validateRace
} = require('../utils/validation');

// checkAdmin: Fa proseguire la richiesta soltanto se la sessione appartiene a un amministratore con ruolo ancora
// valido.
// Riceve: req (richiesta HTTP); res (risposta HTTP); next (passaggio al middleware successivo).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function checkAdmin(req, res, next) {
    // user: Dati dell’utente coinvolto in questo blocco.
    const user = req.session.utenteLoggato;
    // Se il controllo non permette l’accesso, termina la richiesta con lo stato HTTP indicato.
    if (user?.ruolo !== 'ADMIN' || !await hasCurrentRole(user)) {
        return res.status(403).json({ errore: 'Accesso negato. Area riservata.' });
    }
    next();
}

// parseRouteId: Valida l’identificativo nel percorso HTTP; restituisce l’id oppure risponde con errore e
// restituisce null.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
function parseRouteId(req, res) {
    // id: Valore convertito o normalizzato prima del suo utilizzo.
    const id = parsePositiveId(req.params.id);
    if (!id) {
        res.status(400).json({ errore: 'Identificativo non valido.' });
        return null;
    }
    return id;
}

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

// modificaUtente: Blocca l’utente in transazione, applica la callback di scrittura e revoca le sessioni quando
// richiesto.
// Riceve: userId (id dell’utente); write (callback che esegue le modifiche nella transazione).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
// Restituisce l’esito della callback di scrittura oppure null se l’utente non esiste.
async function modificaUtente(userId, write) {
    // connection: Connessione acquisita per mantenere coerenti le operazioni del blocco.
    const connection = await db.promise().getConnection();
    try {
        // Inizia una transazione: le scritture vengono confermate insieme dal commit.
        await connection.beginTransaction();
        // user: Dati dell’utente coinvolto in questo blocco.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const [[user]] = await connection.execute('SELECT ruolo, propic FROM users WHERE id = ? FOR UPDATE', [userId]);
        if (!user) {
            // Annulla le modifiche non confermate della transazione.
            await connection.rollback();
            return null;
        }
        // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const result = await write(connection, user);
        if (result.revoke) await deleteUserSessions(connection, userId);
        // Conferma definitivamente le modifiche della transazione.
        await connection.commit();
        return result;
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        // Annulla le modifiche non confermate della transazione.
        await connection.rollback();
        throw error;
    } finally {
        // Restituisce la connessione al pool, rendendola riutilizzabile.
        connection.release();
    }
}

// ensureAssignableCoach: Controlla nel database che il coach assegnato abbia un ruolo ammesso e comunica l’esito
// alla callback.
// Riceve: coachId (id del coach); callback (funzione da richiamare con l’esito).
function ensureAssignableCoach(coachId, callback) {
    if (!coachId) return callback(null);

    // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
    db.query(
        "SELECT id FROM users WHERE id = ? AND ruolo IN ('ADMIN', 'COACH') LIMIT 1",
        [coachId],
        // Riceve l’esito della query a callback e gestisce errore o righe restituite.
        // Riceve: error (errore intercettato); results (risultati dell’operazione).
        (error, results) => {
            if (error) return callback(error);
            if (results.length === 0) {
                // validationError: Istanza di Error usata dalle operazioni di questo blocco.
                const validationError = new Error('Coach non valido.');
                validationError.status = 400;
                return callback(validationError);
            }
            callback(null);
        }
    );
}

// ensureAssignableCoachAsync: Espone il controllo sul coach come Promise, risolta se il riferimento è valido.
// Riceve: coachId (id del coach).
function ensureAssignableCoachAsync(coachId) {
    // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
    // Riceve: resolve (completa la Promise con successo); reject (completa la Promise con errore).
    return new Promise((resolve, reject) => {
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: error (errore intercettato).
        ensureAssignableCoach(coachId, (error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

// handleWriteError: Prepara la risposta di errore e richiede la rimozione dell’eventuale nuovo file caricato.
// Riceve: res (risposta HTTP); error (errore intercettato); fallbackMessage (testo da usare quando manca un errore
// più specifico); uploadedFile (nuovo file da pulire in caso di errore).
function handleWriteError(res, error, fallbackMessage, uploadedFile) {
    if (uploadedFile) removeUploadedFile(uploadedFile);
    // status: Stato HTTP scelto per la risposta di errore.
    const status = error?.status || 500;
    return res.status(status).json({
        errore: status === 500 ? fallbackMessage : error.message
    });
}

router.use(checkAdmin);

// Gestisce la rotta GET /utenti e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.get('/utenti', (req, res) => {
    // Legge i dati necessari dal database.
    db.query(
        'SELECT id, nome, cognome, email, eta, ruolo, bio, propic, certificato_scadenza FROM users ORDER BY id DESC',
        // Riceve l’esito della query a callback e gestisce errore o righe restituite.
        // Riceve: error (errore intercettato); results (risultati dell’operazione).
        (error, results) => {
            if (error) return res.status(500).json({ errore: 'Errore nel caricamento utenti.' });
            res.json(results);
        }
    );
});

// Gestisce la rotta PUT /utenti/:id e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.put('/utenti/:id', async (req, res) => {
    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = parseRouteId(req, res);
    if (!userId) return;

    // validation: Esito della validazione: contiene i dati normalizzati oppure un errore.
    const validation = validateAdminUserUpdate(req.body);
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (validation.error) return res.status(400).json({ errore: validation.error });

    // nome: Nome letto o normalizzato per il profilo o il form.
    // cognome: Cognome letto o normalizzato per il profilo.
    // eta: Valore della proprietà validation.value, conservato per le operazioni successive.
    // ruolo: Ruolo applicativo usato per stabilire le azioni consentite.
    // bio: Valore della proprietà validation.value, conservato per le operazioni successive.
    // certificato_scadenza: Valore della proprietà validation.value, conservato per le operazioni successive.
    const {
        nome,
        cognome,
        eta,
        ruolo,
        bio,
        certificato_scadenza
    } = validation.value;

    // query: Istruzione SQL con cui leggere o modificare i record previsti.
    const query = `
        UPDATE users
        SET nome = ?, cognome = ?, eta = ?, ruolo = ?, bio = ?, certificato_scadenza = ?
        WHERE id = ?
    `;
    try {
        // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: connection (connessione usata nell’operazione); current (valore corrente).
        // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
        const result = await modificaUtente(userId, async (connection, current) => {
            await connection.execute(query, [nome, cognome, eta, ruolo, bio, certificato_scadenza, userId]);
            return { revoke: current.ruolo !== ruolo };
        });
        if (!result) return res.status(404).json({ errore: 'Utente non trovato.' });

        // isSelf: Indicatore booleano che controlla la condizione descritta dal nome.
        const isSelf = userId === Number(req.session.utenteLoggato.id);
        if (result.revoke) {
            req.app.locals.revokeUserSockets(userId);
            if (isSelf) {
                // Elimina la sessione, impedendo di riutilizzarla per le richieste successive.
                // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
                return req.session.destroy(() => res.json({
                    messaggio: 'Ruolo aggiornato. Accedi di nuovo.',
                    sessione_revocata: true
                }));
            }
        } else if (isSelf) {
            // Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
            Object.assign(req.session.utenteLoggato, { nome, cognome, eta, ruolo, bio, certificato_scadenza });
        }
        return res.json({ messaggio: 'Dati utente aggiornati.' });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Errore aggiornamento utente:', error.code || error.name);
        return res.status(500).json({ errore: 'Errore nel salvataggio dati.' });
    }
});

// Gestisce la rotta PUT /utenti/:id/reset-propic e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.put('/utenti/:id/reset-propic', async (req, res) => {
    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = parseRouteId(req, res);
    if (!userId) return;

    try {
        // users: Elenco degli utenti restituiti dal caricamento.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const users = await queryAsync('SELECT propic FROM users WHERE id = ? LIMIT 1', [userId]);
        if (users.length === 0) return res.status(404).json({ errore: 'Utente non trovato.' });

        // oldImage: Valore della proprietà users.0.propic, conservato per le operazioni successive.
        const oldImage = users[0].propic;
        // result: Dati restituiti dal database al completamento della query.
        // Aggiorna i record individuati dalle condizioni della query; i segnaposto ? ricevono i valori separati dai
        // parametri.
        const result = await queryAsync("UPDATE users SET propic = 'default_user.png' WHERE id = ?", [userId]);
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Utente non trovato.' });

        if (userId === Number(req.session.utenteLoggato.id)) {
            req.session.utenteLoggato.propic = 'default_user.png';
        }
        removeUploadedFileIfUnused(oldImage, db);
        res.json({ messaggio: 'Foto profilo rimossa.' });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Errore reset immagine:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante il reset immagine.' });
    }
});

// Gestisce la rotta DELETE /utenti/:id e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.delete('/utenti/:id', async (req, res) => {
    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = parseRouteId(req, res);
    if (!userId) return;
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (userId === Number(req.session.utenteLoggato.id)) {
        return res.status(400).json({ errore: 'Non puoi cancellare il tuo stesso account.' });
    }

    try {
        // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: connection (connessione usata nell’operazione); user (dati dell’utente).
        // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
        const result = await modificaUtente(userId, async (connection, user) => {
            // attachments: Dati restituiti dal database al completamento della query.
            // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
            const [attachments] = await connection.execute(
                'SELECT file_url FROM messages WHERE user_id = ? AND file_url IS NOT NULL',
                [userId]
            );
            // Elimina i record individuati dalle condizioni della query; i segnaposto ? ricevono i valori separati dai
            // parametri.
            await connection.execute('DELETE FROM users WHERE id = ?', [userId]);
            return { revoke: true, oldImage: user.propic, attachments };
        });
        if (!result) return res.status(404).json({ errore: 'Utente non trovato.' });
        req.app.locals.revokeUserSockets(userId);
        removeUploadedFileIfUnused(result.oldImage, db);
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: row (riga del risultato).
        result.attachments.forEach(row => removeUploadedFileIfUnused(row.file_url, db));
        res.json({ messaggio: 'Utente eliminato definitivamente.' });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Errore cancellazione utente:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante la cancellazione.' });
    }
});

// Gestisce la rotta POST /corsi e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.post('/corsi', uploadCopertina, (req, res) => {
    // validation: Esito della validazione: contiene i dati normalizzati oppure un errore.
    const validation = validateCourse(req.body);
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (validation.error) {
        removeUploadedFile(req.file);
        return res.status(400).json({ errore: validation.error });
    }

    // course: Dati del corso corrente.
    const course = validation.value;
    // imageName: Valore scelto tra i due rami in base alla condizione indicata.
    const imageName = req.file ? req.file.filename : 'default_corso.png';
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: coachError (esito negativo del controllo sul coach).
    ensureAssignableCoach(course.coach_id, (coachError) => {
        if (coachError) return handleWriteError(res, coachError, 'Errore durante la verifica del coach.', req.file);

        // query: Istruzione SQL con cui leggere o modificare i record previsti.
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
            // Riceve l’esito della query a callback e gestisce errore o righe restituite.
            // Riceve: error (errore intercettato).
            (error) => {
                if (error) return handleWriteError(res, error, 'Errore durante la creazione del corso.', req.file);
                res.json({ messaggio: 'Corso creato.' });
            }
        );
    });
});

// Gestisce la rotta PUT /corsi/:id e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.put('/corsi/:id', uploadCopertina, async (req, res) => {
    // courseId: Identificativo del corso interessato.
    const courseId = parseRouteId(req, res);
    if (!courseId) {
        removeUploadedFile(req.file);
        return;
    }

    // validation: Esito della validazione: contiene i dati normalizzati oppure un errore.
    const validation = validateCourse(req.body);
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (validation.error) {
        removeUploadedFile(req.file);
        return res.status(400).json({ errore: validation.error });
    }

    // course: Dati del corso corrente.
    const course = validation.value;
    try {
        await ensureAssignableCoachAsync(course.coach_id);
        // existingCourses: Dati restituiti dal database al completamento della query.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const existingCourses = await queryAsync('SELECT propic FROM corsi WHERE id = ? LIMIT 1', [courseId]);
        if (existingCourses.length === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Corso non trovato.' });
        }

        // oldImage: Valore della proprietà existingCourses.0.propic, conservato per le operazioni successive.
        const oldImage = existingCourses[0].propic;
        // imageFields: Valore scelto tra i due rami in base alla condizione indicata.
        const imageFields = req.file ? ', propic = ?' : '';
        // query: Istruzione SQL con cui leggere o modificare i record previsti.
        const query = `
            UPDATE corsi
            SET nome = ?, giorno = ?, orario_inizio = ?, durata = ?, costo = ?, bio = ?, coach_id = ?
            ${imageFields}
            WHERE id = ?
        `;
        // params: Valori separati dall’istruzione SQL e associati ai suoi segnaposto.
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

        // result: Dati restituiti dal database al completamento della query.
        const result = await queryAsync(query, params);
        if (result.affectedRows === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Corso non trovato.' });
        }

        if (req.file) removeUploadedFileIfUnused(oldImage, db);
        res.json({ messaggio: 'Corso modificato.' });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        return handleWriteError(res, error, 'Errore durante la modifica del corso.', req.file);
    }
});

// Gestisce la rotta DELETE /corsi/:id e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.delete('/corsi/:id', async (req, res) => {
    // courseId: Identificativo del corso interessato.
    const courseId = parseRouteId(req, res);
    if (!courseId) return;

    try {
        // existingCourses: Dati restituiti dal database al completamento della query.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const existingCourses = await queryAsync('SELECT propic FROM corsi WHERE id = ? LIMIT 1', [courseId]);
        if (existingCourses.length === 0) return res.status(404).json({ errore: 'Corso non trovato.' });

        // result: Dati restituiti dal database al completamento della query.
        // Elimina i record individuati dalle condizioni della query; i segnaposto ? ricevono i valori separati dai
        // parametri.
        const result = await queryAsync('DELETE FROM corsi WHERE id = ?', [courseId]);
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Corso non trovato.' });

        removeUploadedFileIfUnused(existingCourses[0].propic, db);
        res.json({ messaggio: 'Corso eliminato.' });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Errore cancellazione corso:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante la cancellazione.' });
    }
});

// Gestisce la rotta POST /gare e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.post('/gare', uploadCopertina, (req, res) => {
    // validation: Esito della validazione: contiene i dati normalizzati oppure un errore.
    const validation = validateRace(req.body);
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (validation.error) {
        removeUploadedFile(req.file);
        return res.status(400).json({ errore: validation.error });
    }

    // race: Dati della gara corrente.
    const race = validation.value;
    // imageName: Valore scelto tra i due rami in base alla condizione indicata.
    const imageName = req.file ? req.file.filename : 'default_gara.png';
    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    db.query(
        'INSERT INTO gare (nome, giorno, orario, costo, bio, propic) VALUES (?, ?, ?, ?, ?, ?)',
        [race.nome, race.giorno, race.orario, race.costo, race.bio, imageName],
        // Riceve l’esito della query a callback e gestisce errore o righe restituite.
        // Riceve: error (errore intercettato).
        (error) => {
            if (error) return handleWriteError(res, error, 'Errore durante la creazione della gara.', req.file);
            res.json({ messaggio: 'Gara creata.' });
        }
    );
});

// Gestisce la rotta PUT /gare/:id e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.put('/gare/:id', uploadCopertina, async (req, res) => {
    // raceId: Identificativo della gara interessata.
    const raceId = parseRouteId(req, res);
    if (!raceId) {
        removeUploadedFile(req.file);
        return;
    }

    // validation: Esito della validazione: contiene i dati normalizzati oppure un errore.
    const validation = validateRace(req.body);
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (validation.error) {
        removeUploadedFile(req.file);
        return res.status(400).json({ errore: validation.error });
    }

    // race: Dati della gara corrente.
    const race = validation.value;
    try {
        // existingRaces: Dati restituiti dal database al completamento della query.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const existingRaces = await queryAsync('SELECT propic FROM gare WHERE id = ? LIMIT 1', [raceId]);
        if (existingRaces.length === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Gara non trovata.' });
        }

        // oldImage: Valore della proprietà existingRaces.0.propic, conservato per le operazioni successive.
        const oldImage = existingRaces[0].propic;
        // imageFields: Valore scelto tra i due rami in base alla condizione indicata.
        const imageFields = req.file ? ', propic = ?' : '';
        // query: Istruzione SQL con cui leggere o modificare i record previsti.
        const query = `
            UPDATE gare
            SET nome = ?, giorno = ?, orario = ?, costo = ?, bio = ?
            ${imageFields}
            WHERE id = ?
        `;
        // params: Valori separati dall’istruzione SQL e associati ai suoi segnaposto.
        const params = [race.nome, race.giorno, race.orario, race.costo, race.bio];
        if (req.file) params.push(req.file.filename);
        params.push(raceId);

        // result: Dati restituiti dal database al completamento della query.
        const result = await queryAsync(query, params);
        if (result.affectedRows === 0) {
            removeUploadedFile(req.file);
            return res.status(404).json({ errore: 'Gara non trovata.' });
        }

        if (req.file) removeUploadedFileIfUnused(oldImage, db);
        res.json({ messaggio: 'Gara modificata.' });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        return handleWriteError(res, error, 'Errore durante la modifica della gara.', req.file);
    }
});

// Gestisce la rotta DELETE /gare/:id e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.delete('/gare/:id', async (req, res) => {
    // raceId: Identificativo della gara interessata.
    const raceId = parseRouteId(req, res);
    if (!raceId) return;

    try {
        // existingRaces: Dati restituiti dal database al completamento della query.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const existingRaces = await queryAsync('SELECT propic FROM gare WHERE id = ? LIMIT 1', [raceId]);
        if (existingRaces.length === 0) return res.status(404).json({ errore: 'Gara non trovata.' });

        // result: Dati restituiti dal database al completamento della query.
        // Elimina i record individuati dalle condizioni della query; i segnaposto ? ricevono i valori separati dai
        // parametri.
        const result = await queryAsync('DELETE FROM gare WHERE id = ?', [raceId]);
        if (result.affectedRows === 0) return res.status(404).json({ errore: 'Gara non trovata.' });

        removeUploadedFileIfUnused(existingRaces[0].propic, db);
        res.json({ messaggio: 'Gara eliminata.' });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Errore cancellazione gara:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante la cancellazione della gara.' });
    }
});

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = router;
