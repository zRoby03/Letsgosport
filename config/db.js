require('dotenv').config();

const mysql = require('mysql2');

const requiredEnv = ['DB_HOST', 'DB_USER', 'DB_NAME'];
const missingEnv = requiredEnv.filter((name) => !String(process.env[name] || '').trim());

if (missingEnv.length > 0) {
    throw new Error(`Variabili database mancanti: ${missingEnv.join(', ')}`);
}

function parseBooleanEnv(name, defaultValue) {
    const value = process.env[name];
    if (value === undefined || value === '') return defaultValue;

    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;

    throw new Error(`${name} non valida: usa true oppure false.`);
}

function parseIntegerEnv(name, defaultValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const value = process.env[name];
    if (value === undefined || value === '') return defaultValue;

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${name} non valida: valore intero atteso tra ${min} e ${max}.`);
    }

    return parsed;
}

const dbHost = process.env.DB_HOST.trim();
const isLocalDb = ['localhost', '127.0.0.1', '::1'].includes(dbHost.toLowerCase());
const useSsl = parseBooleanEnv('DB_SSL', !isLocalDb);

const db = mysql.createPool({
    host: dbHost,
    port: parseIntegerEnv('DB_PORT', useSsl ? 4000 : 3306, { min: 1, max: 65535 }),
    user: process.env.DB_USER.trim(),
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME.trim(),
    ssl: useSsl ? {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
    } : undefined,
    waitForConnections: true,
    connectionLimit: parseIntegerEnv('DB_CONNECTION_LIMIT', 10, { min: 1, max: 100 }),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

db.checkConnection = () => new Promise((resolve, reject) => {
    db.query('SELECT 1 AS ok', (error) => {
        if (error) reject(error);
        else resolve();
    });
});

module.exports = db;
