// API sotto /api/coach: espone al coach autenticato i propri corsi con i relativi iscritti.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// express: Express definisce router, middleware e risposte HTTP.
const express = require('express');
// router: Router Express che raggruppa gli endpoint di questo modulo.
const router = express.Router();
// db: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece
// di aprirne una per richiesta.
const db = require('../config/db');
// hasCurrentRole: Confronta il ruolo nella sessione con quello attuale nel database; restituisce true solo se
// coincidono.
const { hasCurrentRole } = require('../utils/session-access');

// Gestisce la rotta GET /corsi e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
router.get('/corsi', async (req, res) => {
    // user: Dati dell’utente coinvolto in questo blocco.
    const user = req.session.utenteLoggato;
    // Se il controllo non permette l’accesso, termina la richiesta con lo stato HTTP indicato.
    if (user?.ruolo !== 'COACH' || !await hasCurrentRole(user)) {
        return res.status(403).json({ errore: 'Accesso negato. Area riservata ai coach.' });
    }

    // coachId: Identificativo del coach assegnato o autenticato.
    const coachId = user.id;

    // query: Istruzione SQL con cui leggere o modificare i record previsti.
    const query = `
        SELECT c.id AS corso_id, c.nome AS corso_nome, c.giorno, c.orario_inizio,
               u.id AS studente_id, u.nome AS studente_nome, u.cognome AS studente_cognome, u.email,
               u.propic, u.bio, u.eta, u.ruolo
        FROM corsi c
        LEFT JOIN enrollments_corsi ec ON c.id = ec.corso_id
        LEFT JOIN users u ON ec.user_id = u.id
        WHERE c.coach_id = ?
        ORDER BY c.giorno, c.orario_inizio
    `;

    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato); results (risultati dell’operazione).
    db.query(query, [coachId], (err, results) => {
        if (err) return res.status(500).json({ errore: 'Errore database.' });

        // corsiMap: Raccoglie i corsi per id per aggregare le righe degli iscritti.
        const corsiMap = {};
        
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: row (riga del risultato).
        results.forEach(row => {
            if (!corsiMap[row.corso_id]) {
                corsiMap[row.corso_id] = { 
                    id: row.corso_id, 
                    nome: row.corso_nome, 
                    giorno: row.giorno, 
                    orario: row.orario_inizio, 
                    iscritti: [] 
                };
            }
            if (row.studente_id) { 
                corsiMap[row.corso_id].iscritti.push({ 
                    id: row.studente_id, 
                    nome: row.studente_nome, 
                    cognome: row.studente_cognome, 
                    email: row.email,
                    propic: row.propic,
                    bio: row.bio,
                    eta: row.eta,
                    ruolo: row.ruolo
                });
            }
        });

        res.json(Object.values(corsiMap));
    });
});

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = router;
