const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/corsi', (req, res) => {
    if (!req.session.utenteLoggato || req.session.utenteLoggato.ruolo !== 'COACH') {
        return res.status(403).json({ errore: 'Accesso negato. Area riservata ai coach.' });
    }

    const coachId = req.session.utenteLoggato.id;

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

    db.query(query, [coachId], (err, results) => {
        if (err) return res.status(500).json({ errore: 'Errore database.' });

        const corsiMap = {};
        
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

module.exports = router;
