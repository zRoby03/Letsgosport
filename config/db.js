// Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece di aprirne una per richiesta.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// Carica le variabili di ambiente locali usate dalla configurazione del backend.
require('dotenv').config({ quiet: true });

// mysql: mysql2 esegue le query e gestisce il pool di connessioni MySQL compatibili con TiDB.
const mysql = require('mysql2');

// requiredEnv: Nomi delle variabili obbligatorie per collegarsi al database.
const requiredEnv = ['DB_HOST', 'DB_USER', 'DB_NAME'];
// missingEnv: Nomi delle impostazioni obbligatorie che risultano assenti o vuote.
// Restituisce il criterio che decide quali elementi conservare nella nuova lista.
// Riceve: name (nome da utilizzare).
const missingEnv = requiredEnv.filter((name) => !String(process.env[name] || '').trim());

if (missingEnv.length > 0) {
    throw new Error(`Variabili database mancanti: ${missingEnv.join(', ')}`);
}

// parseBooleanEnv: Legge una variabile di ambiente come booleano; accetta i valori previsti oppure segnala una
// configurazione non valida.
// Riceve: name (nome da utilizzare); defaultValue (valore usato quando manca la configurazione).
// Restituisce un booleano oppure solleva un errore se il valore è presente ma non riconosciuto.
function parseBooleanEnv(name, defaultValue) {
    // value: Impostazione letta dalle variabili di ambiente del processo.
    const value = process.env[name];
    if (value === undefined || value === '') return defaultValue;

    // normalized: Valore normalizzato per un confronto o una validazione coerenti.
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;

    throw new Error(`${name} non valida: usa true oppure false.`);
}

// parseIntegerEnv: Legge una variabile di ambiente come intero e ne controlla i limiti; usa il valore predefinito
// se assente.
// Riceve: name (nome da utilizzare); defaultValue (valore usato quando manca la configurazione); min (limite
// inferiore); max (limite superiore).
// Restituisce un intero nell’intervallo ammesso oppure solleva un errore.
function parseIntegerEnv(name, defaultValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    // value: Impostazione letta dalle variabili di ambiente del processo.
    const value = process.env[name];
    if (value === undefined || value === '') return defaultValue;

    // parsed: Risultato della conversione o analisi del valore originale.
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${name} non valida: valore intero atteso tra ${min} e ${max}.`);
    }

    return parsed;
}

// dbHost: Host del database letto dalla configurazione di ambiente.
const dbHost = process.env.DB_HOST.trim();
// isLocalDb: Indica se l’host del database è un indirizzo locale riconosciuto.
const isLocalDb = ['localhost', '127.0.0.1', '::1'].includes(dbHost.toLowerCase());
// useSsl: Stabilisce se la connessione al database usa TLS con verifica del certificato.
const useSsl = parseBooleanEnv('DB_SSL', !isLocalDb);

// db: Pool o interfaccia di connessione al database condivisa dal modulo.
const db = mysql.createPool({
    host: dbHost,
    port: parseIntegerEnv('DB_PORT', useSsl ? 4000 : 3306, { min: 1, max: 65535 }),
    user: process.env.DB_USER.trim(),
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME.trim(),
    // charset: Set di caratteri o collazione usati dal driver per il collegamento al database.
    charset: 'utf8mb4_general_ci',
    ssl: useSsl ? {
        // minVersion: Versione TLS minima accettata dalla configurazione.
        minVersion: 'TLSv1.2',
        // rejectUnauthorized: Controlla il rifiuto dei certificati TLS che non superano la verifica.
        rejectUnauthorized: true
    } : undefined,
    // waitForConnections: Fa attendere le richieste quando tutte le connessioni del pool sono occupate.
    waitForConnections: true,
    // connectionLimit: Numero massimo di connessioni aperte contemporaneamente dal pool.
    connectionLimit: parseIntegerEnv('DB_CONNECTION_LIMIT', 10, { min: 1, max: 100 }),
    // queueLimit: Limita la coda delle richieste in attesa; il significato del valore è quello previsto da mysql2.
    queueLimit: 0,
    // enableKeepAlive: Mantiene attive le connessioni TCP secondo il supporto del driver.
    enableKeepAlive: true,
    // keepAliveInitialDelay: Attesa iniziale del keep-alive TCP espressa in millisecondi.
    keepAliveInitialDelay: 0
});

// Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
db.checkConnection = async () => {
    // Legge i dati necessari dal database.
    await db.promise().query('SELECT client_id FROM messages LIMIT 0');
    // Legge i dati necessari dal database.
    await db.promise().query('SELECT first_user_id FROM private_conversations LIMIT 0');
};

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = db;
