const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/corsi', (req, res) => {
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
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ errore: 'Errore nel caricamento dei corsi.' });
        res.json(results);
    });
});


router.get('/gare', (req, res) => {
    const query = `
        SELECT id, nome, bio, propic, giorno, orario, costo
        FROM gare
        ORDER BY giorno, orario
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ errore: 'Errore nel caricamento delle gare.' });
        res.json(results);
    });
});


router.get('/coaches', (req, res) => {
    db.query('SELECT id, nome, cognome FROM users WHERE ruolo IN ("COACH", "ADMIN") ORDER BY nome, cognome', (err, results) => {
        if (err) return res.status(500).json({ errore: 'Errore nel caricamento dei coach.' });
        res.json(results);
    });
});

module.exports = router;
