// API pubbliche montate sotto /api: restituiscono cataloghi di corsi, gare e coach in formato JSON.
// express: Express definisce router, middleware e risposte HTTP.
const express = require('express');
// router: Router Express che raggruppa gli endpoint di questo modulo.
const router = express.Router();
// db: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece
// di aprirne una per richiesta.
const db = require('../config/db');

// Gestisce la rotta GET /corsi e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.get('/corsi', (req, res) => {
    // query: Istruzione SQL con cui leggere o modificare i record previsti.
    const query = `
        SELECT
            corsi.id,
            corsi.nome,
            corsi.costo,
            corsi.bio,
            corsi.propic,
            corsi.orario_inizio,
            corsi.durata,
            corsi.giorno,
            corsi.coach_id,
            users.nome AS coach_nome,
            users.cognome AS coach_cognome
        FROM corsi 
        LEFT JOIN users ON corsi.coach_id = users.id
        ORDER BY corsi.giorno, corsi.orario_inizio
    `;
    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato); results (risultati dell’operazione).
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ errore: 'Errore nel caricamento dei corsi.' });
        res.json(results);
    });
});


// Gestisce la rotta GET /gare e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.get('/gare', (req, res) => {
    // query: Istruzione SQL con cui leggere o modificare i record previsti.
    const query = `
        SELECT id, nome, bio, propic, DATE_FORMAT(giorno, '%Y-%m-%d') AS giorno, orario, costo
        FROM gare
        ORDER BY giorno, orario
    `;
    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato); results (risultati dell’operazione).
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ errore: 'Errore nel caricamento delle gare.' });
        res.json(results);
    });
});


// Gestisce la rotta GET /coaches e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
router.get('/coaches', (req, res) => {
    // Legge i dati necessari dal database.
    // Riceve l’esito della query a callback e gestisce errore o righe restituite.
    // Riceve: err (errore intercettato); results (risultati dell’operazione).
    db.query('SELECT id, nome, cognome FROM users WHERE ruolo IN ("COACH", "ADMIN") ORDER BY nome, cognome', (err, results) => {
        if (err) return res.status(500).json({ errore: 'Errore nel caricamento dei coach.' });
        res.json(results);
    });
});

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = router;
