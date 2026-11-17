// API di registrazione, login e logout: validazione, reCAPTCHA, hash bcrypt e gestione della sessione.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// Carica le variabili di ambiente locali usate dalla configurazione del backend.
require('dotenv').config();

// axios: Axios invia richieste HTTP ai servizi esterni e supporta timeout ed errori di risposta.
const axios = require('axios');
// bcrypt: bcrypt calcola e verifica hash delle password senza richiedere di salvarle in chiaro.
const bcrypt = require('bcrypt');
// express: Express definisce router, middleware e risposte HTTP.
const express = require('express');
// db: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece
// di aprirne una per richiesta.
const db = require('../config/db');
// validateLogin: Valida email, password e token del form di accesso prima di interrogare il database.
// validateRegistration: Valida i dati di registrazione prima della verifica esterna e dell’hash della password.
const {
    validateLogin,
    validateRegistration
} = require('../utils/validation');

// router: Router Express che raggruppa gli endpoint di questo modulo.
const router = express.Router();
// saltRounds: Costo di lavoro usato da bcrypt per calcolare l’hash della password.
const saltRounds = 10;
// RECAPTCHA_SECRET_KEY: Credenziale del backend per verificare reCAPTCHA con il provider.
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
// LOCAL_RECAPTCHA_TOKEN: Valore riconosciuto soltanto nella modalità locale prevista dal progetto.
const LOCAL_RECAPTCHA_TOKEN = 'local-dev-recaptcha-ok';

// limitAuthAttempts: Crea un middleware che conta i tentativi per indirizzo IP entro una finestra temporale.
// Riceve: max (limite superiore).
function limitAuthAttempts(max) {
    // windowMs: Durata della finestra di conteggio espressa in millisecondi.
    const windowMs = 15 * 60 * 1000;
    // attempts: Mappa dei tentativi di autenticazione con conteggio e scadenza per indirizzo.
    const attempts = new Map();
    // cleanupAfter: Istante dal quale ripetere la pulizia dei tentativi ormai scaduti.
    let cleanupAfter = 0;
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: req (richiesta HTTP); res (risposta HTTP); next (passaggio al middleware successivo).
    return (req, res, next) => {
        // now: Istante attuale in millisecondi usato per scadenze e durate.
        const now = Date.now();
        if (now >= cleanupAfter) {
            // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
            // ip: Indirizzo del client usato dal limite dei tentativi o dalla verifica esterna.
            // entry: Registrazione corrente trovata nella raccolta indicizzata.
            for (const [ip, entry] of attempts) {
                if (entry.expiresAt <= now) attempts.delete(ip);
            }
            cleanupAfter = now + windowMs;
        }
        // ip: Indirizzo del client usato dal limite dei tentativi o dalla verifica esterna.
        const ip = req.ip || req.socket.remoteAddress;
        // entry: Registrazione corrente trovata nella raccolta indicizzata.
        let entry = attempts.get(ip);
        if (!entry || entry.expiresAt <= now) {
            entry = { count: 0, expiresAt: now + windowMs };
            attempts.set(ip, entry);
        }
        if (++entry.count > max) {
            res.set('Retry-After', String(Math.ceil((entry.expiresAt - now) / 1000)));
            return res.status(429).json({ errore: 'Troppi tentativi. Riprova più tardi.' });
        }
        next();
    };
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

// regenerateSession: Rigenera l’identificativo della sessione dopo il login per separarlo da quello precedente.
// Riceve: req (richiesta HTTP).
function regenerateSession(req) {
    // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
    // Riceve: resolve (completa la Promise con successo); reject (completa la Promise con errore).
    return new Promise((resolve, reject) => {
        // Cambia l’identificativo della sessione per separare lo stato prima e dopo il login.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: error (errore intercettato).
        req.session.regenerate((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

// saveSession: Attende che la sessione sia salvata prima di completare la risposta HTTP.
// Riceve: req (richiesta HTTP).
function saveSession(req) {
    // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
    // Riceve: resolve (completa la Promise con successo); reject (completa la Promise con errore).
    return new Promise((resolve, reject) => {
        // Persiste la sessione nell’archivio configurato.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: error (errore intercettato).
        req.session.save((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

// isLocalDevelopmentRequest: Riconosce le richieste locali soltanto quando l’applicazione non è in modalità
// produzione.
// Riceve: req (richiesta HTTP).
function isLocalDevelopmentRequest(req) {
    if (process.env.NODE_ENV === 'production') return false;

    // host: Valore convertito o normalizzato prima del suo utilizzo.
    const host = String(req.hostname || '').toLowerCase();
    // ip: Indirizzo del client usato dal limite dei tentativi o dalla verifica esterna.
    const ip = String(req.ip || req.socket?.remoteAddress || '');

    return (
        ['localhost', '127.0.0.1', '::1'].includes(host) ||
        ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)
    );
}

// verifyRecaptcha: Verifica il token tramite il servizio di Google, con l’eccezione locale già prevista dal
// codice.
// Riceve: token (token da verificare); req (richiesta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function verifyRecaptcha(token, req) {
    // Il caso indicato soddisfa già il controllo: restituisce subito true.
    if (token === LOCAL_RECAPTCHA_TOKEN && isLocalDevelopmentRequest(req)) return true;
    if (!RECAPTCHA_SECRET_KEY) return false;

    // body: Corpo della richiesta o della risposta trattato in questo blocco.
    const body = new URLSearchParams({
        secret: RECAPTCHA_SECRET_KEY,
        response: token
    });
    if (req.ip) body.set('remoteip', req.ip);

    // response: Risposta ricevuta dal backend o dal servizio esterno.
    const response = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        body.toString(),
        {
            // timeout: Tempo massimo dell’operazione espresso in millisecondi.
            timeout: 7000,
            // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
    );
    return response.data?.success === true;
}

// Gestisce la rotta POST /registrati e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.post('/registrati', limitAuthAttempts(20), async (req, res) => {
    // validation: Esito della validazione: contiene i dati normalizzati oppure un errore.
    const validation = validateRegistration(req.body);
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (validation.error) return res.status(400).json({ errore: validation.error });

    // nome: Nome letto o normalizzato per il profilo o il form.
    // cognome: Cognome letto o normalizzato per il profilo.
    // email: Indirizzo dell’account usato nel controllo o nella richiesta.
    // password: Password mantenuta in memoria per la validazione o il confronto con l’hash.
    // recaptchaToken: Risposta del controllo reCAPTCHA da verificare sul backend.
    const { nome, cognome, email, password, recaptchaToken } = validation.value;

    try {
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (!await verifyRecaptcha(recaptchaToken, req)) {
            return res.status(400).json({ errore: 'Verifica reCAPTCHA fallita. Riprova.' });
        }

        // hashedPassword: Hash bcrypt da salvare al posto della password in chiaro.
        // Calcola l’hash bcrypt prima del salvataggio della password.
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
        await queryAsync(
            'INSERT INTO users (nome, cognome, email, password) VALUES (?, ?, ?, ?)',
            [nome, cognome, email, hashedPassword]
        );

        res.json({ messaggio: 'Registrazione completata. Ora puoi accedere.' });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ errore: 'Questa email è già registrata.' });
        }
        console.error('Registrazione fallita:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante la registrazione.' });
    }
});

// Gestisce la rotta POST /login e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.post('/login', limitAuthAttempts(60), async (req, res) => {
    // validation: Esito della validazione: contiene i dati normalizzati oppure un errore.
    const validation = validateLogin(req.body);
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (validation.error) return res.status(400).json({ errore: validation.error });

    // email: Indirizzo dell’account usato nel controllo o nella richiesta.
    // password: Password mantenuta in memoria per la validazione o il confronto con l’hash.
    // recaptchaToken: Risposta del controllo reCAPTCHA da verificare sul backend.
    const { email, password, recaptchaToken } = validation.value;

    try {
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (!await verifyRecaptcha(recaptchaToken, req)) {
            return res.status(400).json({ errore: 'Verifica reCAPTCHA fallita. Riprova.' });
        }

        // users: Elenco degli utenti restituiti dal caricamento.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const users = await queryAsync(
            `SELECT id, nome, cognome, email, ruolo, eta, bio, propic, password
             FROM users
             WHERE email = ?
             LIMIT 1`,
            [email]
        );
        if (users.length === 0) {
            return res.status(401).json({ errore: 'Email o password errate.' });
        }

        // user: Dati dell’utente coinvolto in questo blocco.
        const user = users[0];
        // Confronta la password ricevuta con l’hash conservato, senza decifrare l’hash.
        if (!await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ errore: 'Email o password errate.' });
        }

        delete user.password;
        // courseEnrollments: Iscrizioni ai corsi recuperate per l’utente.
        // raceEnrollments: Iscrizioni alle gare recuperate per l’utente.
        const [courseEnrollments, raceEnrollments] = await Promise.all([
            // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
            queryAsync('SELECT corso_id AS id FROM enrollments_corsi WHERE user_id = ?', [user.id]),
            // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
            queryAsync('SELECT gara_id AS id FROM enrollments_gare WHERE user_id = ?', [user.id])
        ]);

        await regenerateSession(req);
        req.session.utenteLoggato = user;
        await saveSession(req);

        res.json({
            messaggio: 'Login effettuato.',
            utente: user,
            iscrizioni: courseEnrollments,
            iscrizioni_gare: raceEnrollments
        });
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Login fallito:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante il login.' });
    }
});

// Gestisce la rotta POST /logout e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.post('/logout', (req, res) => {
    // Elimina la sessione, impedendo di riutilizzarla per le richieste successive.
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: error (errore intercettato).
    req.session.destroy((error) => {
        if (error) {
            console.error('Logout fallito:', error.code || error.message);
            return res.status(500).json({ errore: 'Impossibile terminare la sessione.' });
        }

        res.clearCookie('connect.sid', {
            // httpOnly: Impedisce al JavaScript della pagina di leggere il cookie di sessione.
            httpOnly: true,
            // sameSite: Regola l’invio del cookie nelle richieste tra siti; è una protezione aggiuntiva, non una validazione
            // dei dati.
            sameSite: 'lax',
            // secure: Controlla se il cookie può essere inviato soltanto tramite HTTPS.
            secure: process.env.NODE_ENV === 'production'
        });
        res.json({ messaggio: 'Logout effettuato.' });
    });
});

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = router;
