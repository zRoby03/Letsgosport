// Protegge nomi e riferimenti degli upload e firma token temporanei monouso legati a utente e stanza.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// crypto: Le API crittografiche producono valori casuali, impronte e firme usate nei controlli del progetto.
const crypto = require('crypto');
// legacyDir: Directory storica degli upload esportata dal modulo di storage.
// removeMedia: Rimuove il media dagli storage previsti senza cancellare percorsi costruiti da nomi non validi.
// safeMediaPath: Restituisce un percorso interno alla directory consentita oppure null se il nome non è sicuro.
const { legacyDir, removeMedia, safeMediaPath } = require('../config/media-storage');

// usedUploadTokens: Mappa in memoria dei token di upload già consumati e delle loro scadenze.
const usedUploadTokens = new Map();
// TOKEN_TTL_MS: Durata dei token di upload espressa in millisecondi.
const TOKEN_TTL_MS = 10 * 60 * 1000;
// GENERATED_UPLOAD_NAME: Espressione regolare che riconosce i nomi generati dal sistema di upload.
const GENERATED_UPLOAD_NAME = /^\d{12,}_[a-f0-9]{16}_[\w.-]+\.[a-z0-9]+$/i;

// getSigningSecret: Recupera il segreto con cui firmare i token di upload, usando il ripiego locale previsto.
function getSigningSecret() {
    return process.env.SESSION_SECRET || 'local-development-upload-secret';
}

// safeUploadPath: Ricava il percorso autorizzato del vecchio upload oppure null per un nome non sicuro.
// Riceve: filename (nome del file).
function safeUploadPath(filename) {
    return safeMediaPath(legacyDir, filename);
}

// uploadFilename: Estrae il nome sia da una stringa sia dall’oggetto che rappresenta il file.
// Riceve: fileOrName (file o nome da identificare).
function uploadFilename(fileOrName) {
    return typeof fileOrName === 'string' ? fileOrName : fileOrName?.filename;
}

// isGeneratedUploadName: Controlla che il nome rispetti il formato degli upload generati e il percorso consentito.
// Riceve: filename (nome del file).
function isGeneratedUploadName(filename) {
    return typeof filename === 'string'
        && GENERATED_UPLOAD_NAME.test(filename)
        && Boolean(safeUploadPath(filename));
}

// removeUploadedFile: Rimuove un upload generato dall’applicazione; restituisce l’esito senza propagare errori di
// cancellazione.
// Riceve: fileOrName (file o nome da identificare).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function removeUploadedFile(fileOrName) {
    // filename: Risultato di uploadFilename. Estrae il nome sia da una stringa sia dall’oggetto che rappresenta il
    // file.
    const filename = uploadFilename(fileOrName);
    if (!isGeneratedUploadName(filename)) return false;
    try {
        await removeMedia(filename);
        return true;
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Errore rimozione file upload:', error.code || error.name);
        return false;
    }
}

// queryAsync: Converte la query a callback in una Promise: resolve consegna le righe e reject propaga l’errore.
// Riceve: db (connessione o pool del database); sql (istruzione SQL); params (valori separati della query).
// Restituisce una Promise risolta con i risultati SQL o rifiutata con l’errore del database.
function queryAsync(db, sql, params = []) {
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

// uploadIsReferenced: Verifica in parallelo se profili, corsi, gare o messaggi usano ancora questo file.
// Riceve: filename (nome del file); db (connessione o pool del database).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function uploadIsReferenced(filename, db) {
    // checks: Esiti delle verifiche parallele dei riferimenti al file.
    const checks = await Promise.all([
        queryAsync(db, 'SELECT id FROM users WHERE propic = ? LIMIT 1', [filename]),
        queryAsync(db, 'SELECT id FROM corsi WHERE propic = ? LIMIT 1', [filename]),
        queryAsync(db, 'SELECT id FROM gare WHERE propic = ? LIMIT 1', [filename]),
        queryAsync(db, 'SELECT id FROM messages WHERE file_url = ? LIMIT 1', [filename])
    ]);

    // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
    // Riceve: results (risultati dell’operazione).
    return checks.some(results => results.length > 0);
}

// removeUploadedFileIfUnused: Cancella il file soltanto se è un upload riconosciuto e non risultano riferimenti
// nel database.
// Riceve: fileOrName (file o nome da identificare); db (connessione o pool del database).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function removeUploadedFileIfUnused(fileOrName, db) {
    // filename: Risultato di uploadFilename. Estrae il nome sia da una stringa sia dall’oggetto che rappresenta il
    // file.
    const filename = uploadFilename(fileOrName);
    if (!isGeneratedUploadName(filename) || !db) return false;

    try {
        if (await uploadIsReferenced(filename, db)) return false;
        return await removeUploadedFile(filename);
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Errore controllo riferimenti upload:', error.code || error.message);
        return false;
    }
}

// encodePayload: Serializza i dati del token e li converte in base64url per il trasporto.
// Riceve: payload (dati dell’operazione).
function encodePayload(payload) {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

// signPayload: Calcola una firma HMAC dei dati codificati usando il segreto del server.
// Riceve: encodedPayload (dati già codificati da firmare).
function signPayload(encodedPayload) {
    return crypto
        .createHmac('sha256', getSigningSecret())
        .update(encodedPayload)
        .digest('base64url');
}

// cleanTokenRoom: Normalizza il riferimento alla stanza da associare al token di upload.
// Riceve: room (identificativo della stanza).
function cleanTokenRoom(room) {
    return typeof room === 'string' && room.length > 0 && room.length <= 50 ? room : null;
}

// createChatUploadToken: Crea un token firmato con nome, MIME, utente, stanza e scadenza dell’upload.
// Riceve: filename (nome del file); mimetype (tipo MIME del contenuto); userId (id dell’utente); room
// (identificativo della stanza).
function createChatUploadToken({ filename, mimetype, userId, room }) {
    // tokenRoom: Identificativo della stanza normalizzato per il controllo del token.
    const tokenRoom = cleanTokenRoom(room);
    // Rifiuta lo stato non valido sollevando l’errore previsto, senza proseguire con le operazioni successive.
    if (!tokenRoom) throw new Error('Stanza upload non valida.');

    // payload: Dati strutturati dell’operazione o del token nel contesto corrente.
    const payload = encodePayload({
        filename,
        mimetype,
        userId: Number(userId),
        room: tokenRoom,
        expiresAt: Date.now() + TOKEN_TTL_MS,
        nonce: crypto.randomBytes(12).toString('hex')
    });

    return `${payload}.${signPayload(payload)}`;
}

// pruneUsedTokens: Elimina dalla memoria le registrazioni dei token già scaduti.
function pruneUsedTokens() {
    // now: Istante attuale in millisecondi usato per scadenze e durate.
    const now = Date.now();
    // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
    // tokenHash: Impronta del token usata per riconoscerne il riutilizzo senza conservarlo in chiaro.
    // expiresAt: Istante di scadenza del token o delle credenziali.
    for (const [tokenHash, expiresAt] of usedUploadTokens) {
        if (expiresAt <= now) usedUploadTokens.delete(tokenHash);
    }
}

// consumeChatUploadToken: Verifica firma, scadenza, utente, stanza e file e impedisce il riuso del token nel
// processo corrente.
// Riceve: token (token da verificare); filename (nome del file); mimetype (tipo MIME del contenuto); userId (id
// dell’utente); room (identificativo della stanza).
function consumeChatUploadToken(token, { filename, mimetype, userId, room }) {
    // tokenRoom: Identificativo della stanza normalizzato per il controllo del token.
    const tokenRoom = cleanTokenRoom(room);
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (!tokenRoom) return false;

    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (typeof token !== 'string' || token.length > 1500) return false;
    // payloadPart: Risultato della chiamata token.split, riutilizzato nelle istruzioni successive.
    // signaturePart: Risultato della chiamata token.split, riutilizzato nelle istruzioni successive.
    // extra: Risultato della chiamata token.split, riutilizzato nelle istruzioni successive.
    const [payloadPart, signaturePart, extra] = token.split('.');
    if (!payloadPart || !signaturePart || extra) return false;

    // expectedSignature: Firma ricalcolata sul backend per il confronto con quella ricevuta.
    const expectedSignature = signPayload(payloadPart);
    // actual: Risultato della chiamata Buffer.from, riutilizzato nelle istruzioni successive.
    const actual = Buffer.from(signaturePart);
    // expected: Risultato della chiamata Buffer.from, riutilizzato nelle istruzioni successive.
    const expected = Buffer.from(expectedSignature);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;

    // payload: Dati strutturati dell’operazione o del token nel contesto corrente.
    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch {
        return false;
    }

    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (
        payload.expiresAt <= Date.now() ||
        payload.filename !== filename ||
        payload.mimetype !== mimetype ||
        Number(payload.userId) !== Number(userId) ||
        payload.room !== tokenRoom ||
        !safeUploadPath(payload.filename)
    ) {
        return false;
    }

    pruneUsedTokens();
    // tokenHash: Impronta del token usata per riconoscerne il riutilizzo senza conservarlo in chiaro.
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (usedUploadTokens.has(tokenHash)) return false;
    usedUploadTokens.set(tokenHash, payload.expiresAt);
    return true;
}

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = {
    CHAT_UPLOAD_TOKEN_TTL_MS: TOKEN_TTL_MS,
    createChatUploadToken,
    consumeChatUploadToken,
    isGeneratedUploadName,
    removeUploadedFile,
    removeUploadedFileIfUnused,
    safeUploadPath
};
