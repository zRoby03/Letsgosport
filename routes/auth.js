require('dotenv').config();

const axios = require('axios');
const bcrypt = require('bcrypt');
const express = require('express');
const db = require('../config/db');
const {
    validateLogin,
    validateRegistration
} = require('../utils/validation');

const router = express.Router();
const saltRounds = 10;
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
const LOCAL_RECAPTCHA_TOKEN = 'local-dev-recaptcha-ok';

function queryAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, results) => {
            if (error) reject(error);
            else resolve(results);
        });
    });
}

function regenerateSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function isLocalDevelopmentRequest(req) {
    if (process.env.NODE_ENV === 'production') return false;

    const host = String(req.hostname || '').toLowerCase();
    const ip = String(req.ip || req.socket?.remoteAddress || '');

    return (
        ['localhost', '127.0.0.1', '::1'].includes(host) ||
        ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)
    );
}

async function verifyRecaptcha(token, req) {
    if (token === LOCAL_RECAPTCHA_TOKEN && isLocalDevelopmentRequest(req)) return true;
    if (!RECAPTCHA_SECRET_KEY) return false;

    const body = new URLSearchParams({
        secret: RECAPTCHA_SECRET_KEY,
        response: token
    });
    if (req.ip) body.set('remoteip', req.ip);

    const response = await axios.post(
        'https://www.google.com/recaptcha/api/siteverify',
        body.toString(),
        {
            timeout: 7000,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
    );
    return response.data?.success === true;
}

router.post('/registrati', async (req, res) => {
    const validation = validateRegistration(req.body);
    if (validation.error) return res.status(400).json({ errore: validation.error });

    const { nome, cognome, email, password, recaptchaToken } = validation.value;

    try {
        if (!await verifyRecaptcha(recaptchaToken, req)) {
            return res.status(400).json({ errore: 'Verifica reCAPTCHA fallita. Riprova.' });
        }

        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await queryAsync(
            'INSERT INTO users (nome, cognome, email, password) VALUES (?, ?, ?, ?)',
            [nome, cognome, email, hashedPassword]
        );

        res.json({ messaggio: 'Registrazione completata. Ora puoi accedere.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ errore: 'Questa email è già registrata.' });
        }
        console.error('Registrazione fallita:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante la registrazione.' });
    }
});

router.post('/login', async (req, res) => {
    const validation = validateLogin(req.body);
    if (validation.error) return res.status(400).json({ errore: validation.error });

    const { email, password, recaptchaToken } = validation.value;

    try {
        if (!await verifyRecaptcha(recaptchaToken, req)) {
            return res.status(400).json({ errore: 'Verifica reCAPTCHA fallita. Riprova.' });
        }

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

        const user = users[0];
        if (!await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ errore: 'Email o password errate.' });
        }

        delete user.password;
        const [courseEnrollments, raceEnrollments] = await Promise.all([
            queryAsync('SELECT corso_id AS id FROM enrollments_corsi WHERE user_id = ?', [user.id]),
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
        console.error('Login fallito:', error.code || error.message);
        res.status(500).json({ errore: 'Errore durante il login.' });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error('Logout fallito:', error.code || error.message);
            return res.status(500).json({ errore: 'Impossibile terminare la sessione.' });
        }

        res.clearCookie('connect.sid', {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production'
        });
        res.json({ messaggio: 'Logout effettuato.' });
    });
});

module.exports = router;
