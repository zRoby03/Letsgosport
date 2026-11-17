// Multer legge i form multipart; questo modulo controlla estensioni, MIME, firme dei file e salvataggio.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// crypto: Le API crittografiche producono valori casuali, impronte e firme usate nei controlli del progetto.
const crypto = require('crypto');
// fs: Le API del filesystem leggono, scrivono e controllano i file sul disco.
const fs = require('fs');
// os: os fornisce informazioni del sistema, inclusa la directory dei file temporanei.
const os = require('node:os');
// path: path costruisce e verifica percorsi con i separatori corretti del sistema operativo.
const path = require('path');
// multer: Multer interpreta i form multipart e riceve file e campi degli upload.
const multer = require('multer');
// mediaWritable: Indica se la configurazione permette di scrivere media nello storage disponibile.
// storeMedia: Salva un upload su S3 o disco locale; sullo storage remoto coordina anche prenotazione e rilascio
// dello spazio.
const { mediaWritable, storeMedia } = require('./media-storage');

// uploadDir: Directory temporanea in cui Multer riceve gli upload prima della validazione.
const uploadDir = path.join(os.tmpdir(), 'letsgosport-uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// IMAGE_TYPES: Insieme dei tipi MIME accettati per le immagini.
const IMAGE_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
]);

// CHAT_TYPES: Insieme dei tipi MIME ammessi per gli allegati della chat.
const CHAT_TYPES = new Set([
    ...IMAGE_TYPES,
    'application/pdf',
    'audio/webm',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/mp4',
    'audio/aac',
    'audio/m4a',
    'audio/x-m4a'
]);

// EXT_BY_MIME: Associa a ciascun MIME riconosciuto l’estensione da usare per il file.
const EXT_BY_MIME = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
    'audio/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/mp4': '.mp4',
    'audio/aac': '.aac',
    'audio/m4a': '.m4a',
    'audio/x-m4a': '.m4a'
};

// EXTENSIONS_BY_MIME: Associa a ciascun MIME l’insieme delle estensioni originali compatibili.
const EXTENSIONS_BY_MIME = {
    'image/jpeg': new Set(['.jpg', '.jpeg']),
    'image/png': new Set(['.png']),
    'image/webp': new Set(['.webp']),
    'image/gif': new Set(['.gif']),
    'application/pdf': new Set(['.pdf']),
    'audio/webm': new Set(['.webm']),
    'audio/mpeg': new Set(['.mp3']),
    'audio/mp3': new Set(['.mp3']),
    'audio/wav': new Set(['.wav']),
    'audio/x-wav': new Set(['.wav']),
    'audio/ogg': new Set(['.ogg', '.oga']),
    'audio/mp4': new Set(['.mp4', '.m4a']),
    'audio/aac': new Set(['.aac']),
    'audio/m4a': new Set(['.m4a']),
    'audio/x-m4a': new Set(['.m4a'])
};

// safeBaseName: Pulisce il nome originale del file e lo accorcia, eliminando caratteri inadatti a un nome di
// upload.
// Riceve: originalName (nome originale del file).
function safeBaseName(originalName) {
    // parsed: Risultato della conversione o analisi del valore originale.
    const parsed = path.parse(originalName || 'file');
    // normalized: Valore normalizzato per un confronto o una validazione coerenti.
    const normalized = parsed.name
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60);

    return normalized || 'file';
}

// extensionFor: Sceglie l’estensione coerente con il tipo MIME consentito oppure restituisce una stringa vuota.
// Riceve: file (file ricevuto o da elaborare); allowedTypes (insieme dei tipi MIME ammessi).
function extensionFor(file, allowedTypes) {
    // mimeExt: Estensione prevista per il MIME dichiarato.
    const mimeExt = EXT_BY_MIME[file.mimetype];
    // originalExt: Estensione del nome originale normalizzata in minuscolo.
    const originalExt = path.extname(file.originalname || '').toLowerCase();

    if (mimeExt) return mimeExt;
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (allowedTypes.has(file.mimetype) && originalExt.length <= 10) return originalExt;
    return '';
}

// createUpload: Costruisce la configurazione Multer con cartella temporanea, nome casuale, tipi consentiti e
// limiti.
// Riceve: allowedTypes (insieme dei tipi MIME ammessi); maxSizeBytes (dimensione massima in byte).
function createUpload({ allowedTypes, maxSizeBytes }) {
    // storage: Configurazione di archiviazione passata a Multer.
    const storage = multer.diskStorage({
        // destination: Comunica a Multer la directory temporanea in cui scrivere il file ricevuto.
        // Riceve: req (richiesta HTTP); file (file ricevuto o da elaborare); cb (callback a cui comunicare esito o
        // valore).
        destination(req, file, cb) {
            cb(null, uploadDir);
        },
        // filename: Genera per Multer un nome composto da tempo, parte casuale, nome pulito ed estensione.
        // Riceve: req (richiesta HTTP); file (file ricevuto o da elaborare); cb (callback a cui comunicare esito o
        // valore).
        filename(req, file, cb) {
            // random: Parte casuale che riduce le collisioni tra nomi di upload.
            const random = crypto.randomBytes(8).toString('hex');
            // ext: Estensione selezionata per il nome del file.
            const ext = extensionFor(file, allowedTypes);
            // base: Parte principale del nome del file dopo la pulizia.
            const base = safeBaseName(file.originalname);
            cb(null, `${Date.now()}_${random}_${base}${ext}`);
        }
    });

    return multer({
        storage,
        limits: {
            fileSize: maxSizeBytes,
            files: 1,
            fields: 20,
            fieldSize: 20 * 1024,
            parts: 25
        },
        // fileFilter: Accetta il file solo se MIME ed estensione sono compatibili con gli elenchi consentiti.
        // Riceve: req (richiesta HTTP); file (file ricevuto o da elaborare); cb (callback a cui comunicare esito o
        // valore).
        fileFilter(req, file, cb) {
            file.mimetype = String(file.mimetype || '').split(';', 1)[0].toLowerCase();
            if (!allowedTypes.has(file.mimetype)) {
                // err: Istanza di Error usata dalle operazioni di questo blocco.
                const err = new Error('Tipo di file non consentito.');
                err.code = 'LIMIT_FILE_TYPE';
                return cb(err);
            }

            // originalExt: Estensione del nome originale normalizzata in minuscolo.
            const originalExt = path.extname(file.originalname || '').toLowerCase();
            // allowedExtensions: Estensioni compatibili con il MIME del file.
            const allowedExtensions = EXTENSIONS_BY_MIME[file.mimetype];
            // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
            if (!allowedExtensions || !allowedExtensions.has(originalExt)) {
                // err: Istanza di Error usata dalle operazioni di questo blocco.
                const err = new Error('Estensione del file non coerente con il tipo dichiarato.');
                err.code = 'LIMIT_FILE_TYPE';
                return cb(err);
            }

            cb(null, true);
        }
    });
}

// hasBytes: Confronta una sequenza di byte con il buffer a partire dall’offset indicato; restituisce true se
// coincide.
// Riceve: buffer (sequenza di byte da esaminare); bytes (dimensione in byte); offset (posizione iniziale nel
// buffer).
function hasBytes(buffer, bytes, offset = 0) {
    // Controlla il criterio che deve essere soddisfatto da tutti gli elementi.
    // Riceve: byte (byte atteso nel confronto); index (posizione nell’elenco).
    return bytes.every((byte, index) => buffer[offset + index] === byte);
}

// fileSignatureMatches: Controlla i byte caratteristici del formato dichiarato; restituisce false per firme non
// riconosciute.
// Riceve: buffer (sequenza di byte da esaminare); mimetype (tipo MIME del contenuto).
function fileSignatureMatches(buffer, mimetype) {
    if (mimetype === 'image/jpeg') return hasBytes(buffer, [0xff, 0xd8, 0xff]);
    if (mimetype === 'image/png') return hasBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (mimetype === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
    if (mimetype === 'image/webp') {
        return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    if (mimetype === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    if (mimetype === 'audio/webm') return hasBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
    if (mimetype === 'audio/ogg') return buffer.subarray(0, 4).toString('ascii') === 'OggS';
    if (mimetype === 'audio/wav' || mimetype === 'audio/x-wav') {
        return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
    }
    if (mimetype === 'audio/mp4' || mimetype === 'audio/m4a' || mimetype === 'audio/x-m4a') {
        return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    }
    if (mimetype === 'audio/aac') {
        return buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
    }
    if (mimetype === 'audio/mpeg' || mimetype === 'audio/mp3') {
        return buffer.subarray(0, 3).toString('ascii') === 'ID3'
            || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    }
    return false;
}

// validateStoredFile: Legge l’inizio del file temporaneo e ne verifica la firma, chiudendo sempre il descrittore
// aperto.
// Riceve: file (file ricevuto o da elaborare).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
// La Promise restituisce true soltanto se i byte letti corrispondono al MIME dichiarato.
async function validateStoredFile(file) {
    // handle: Descrittore del file aperto, da chiudere al termine della lettura.
    const handle = await fs.promises.open(file.path, 'r');
    try {
        // buffer: Buffer binario usato per leggere o confrontare il contenuto.
        const buffer = Buffer.alloc(32);
        // bytesRead: Numero di byte effettivamente letti dal file.
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return bytesRead > 0 && fileSignatureMatches(buffer.subarray(0, bytesRead), file.mimetype);
    } finally {
        await handle.close();
    }
}

// singleUpload: Adatta un upload Multer a middleware Express e aggiunge validazione, salvataggio e pulizia del
// temporaneo.
// Riceve: middleware (middleware Multer da adattare); fieldName (nome del campo multipart).
function singleUpload(middleware, fieldName) {
    // uploadSingle: Middleware Multer che riceve il singolo campo file previsto.
    const uploadSingle = middleware.single(fieldName);

    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: req (richiesta HTTP); res (risposta HTTP); next (passaggio al middleware successivo).
    return (req, res, next) => {
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: err (errore intercettato).
        // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
        uploadSingle(req, res, async (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ errore: 'File troppo grande.' });
                }

                if (err.code === 'LIMIT_FILE_TYPE') {
                    return res.status(400).json({ errore: err.message });
                }

                return res.status(400).json({ errore: 'Upload non valido.' });
            }

            if (!req.file) return next();

            // file: Valore della proprietà req.file, conservato per le operazioni successive.
            const file = req.file;
            try {
                if (!mediaWritable()) {
                    req.file = undefined;
                    return res.status(503).json({ errore: 'Archiviazione file temporaneamente non disponibile.' });
                }
                // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
                if (!await validateStoredFile(file)) {
                    req.file = undefined;
                    return res.status(400).json({ errore: 'Contenuto del file non valido.' });
                }
                await storeMedia(file);
            } catch (error) {
                // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
                req.file = undefined;
                if (error.code === 'MEDIA_STORAGE_QUOTA_EXCEEDED') {
                    return res.status(409).json({ errore: 'Spazio disponibile per i file esaurito. I nuovi caricamenti sono temporaneamente bloccati.' });
                }
                console.error('Errore archiviazione upload:', error.code || error.name);
                return res.status(503).json({ errore: 'Impossibile salvare il file caricato. Riprova.' });
            } finally {
                // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
                await fs.promises.unlink(file.path).catch(() => {});
            }
            return next();
        });
    };
}

// mediaTypeForName: Ricava un MIME riconosciuto dall’estensione di un nome sicuro oppure restituisce null.
// Riceve: filename (nome del file).
function mediaTypeForName(filename) {
    if (typeof filename !== 'string' || filename.length > 255 || !/^[\w.-]+$/.test(filename)) return null;
    // extension: Risultato della chiamata path.extname.toLowerCase, riutilizzato nelle istruzioni successive.
    const extension = path.extname(filename).toLowerCase();
    // Restituisce il criterio per individuare il primo elemento corrispondente.
    // Riceve: type (tipo previsto).
    return Object.keys(EXTENSIONS_BY_MIME).find(type => EXTENSIONS_BY_MIME[type].has(extension)) || null;
}

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = {
    fileSignatureMatches,
    mediaTypeForName,
    uploadProfilo: singleUpload(createUpload({
        allowedTypes: IMAGE_TYPES,
        maxSizeBytes: 2 * 1024 * 1024
    }), 'immagine'),

    uploadCopertina: singleUpload(createUpload({
        allowedTypes: IMAGE_TYPES,
        maxSizeBytes: 5 * 1024 * 1024
    }), 'propic'),

    uploadChat: singleUpload(createUpload({
        allowedTypes: CHAT_TYPES,
        maxSizeBytes: 10 * 1024 * 1024
    }), 'file_chat')
};
