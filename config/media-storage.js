// Rende uniforme il salvataggio, la lettura e la cancellazione dei media su disco locale o storage S3 compatibile.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// createReadStream: Legge il file per frammenti anziché caricarlo interamente in memoria.
const { createReadStream } = require('node:fs');
// fs: Questa interfaccia del filesystem restituisce Promise utilizzabili con await.
const fs = require('node:fs/promises');
// path: path costruisce e verifica percorsi con i separatori corretti del sistema operativo.
const path = require('node:path');
// finished: Restituisce una Promise che segnala fine o chiusura dello stream.
// pipeline: Collega gli stream propagando gli errori e completando una Promise.
const { finished, pipeline } = require('node:stream/promises');
// DeleteObjectCommand: Comando che elimina un oggetto dallo storage S3.
// GetObjectCommand: Comando che legge il contenuto di un oggetto S3.
// HeadObjectCommand: Comando che verifica i metadati di un oggetto S3 senza leggerne il contenuto.
// PutObjectCommand: Comando che trasferisce un oggetto nello storage S3.
// S3Client: Client che esegue le richieste verso uno storage compatibile S3.
const { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
// reserveMediaStorage: Prenota spazio con un lock nel database; confronta oggetti S3 e prenotazioni e restituisce
// una funzione di rilascio.
const { reserveMediaStorage } = require('./media-quota');

// legacyDir: Directory storica degli upload mantenuta come sorgente o ripiego di lettura.
const legacyDir = path.resolve(__dirname, '..', 'public', 'uploads');
// localDir: Directory dello storage locale selezionata dalla configurazione.
const localDir = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, '..', '.data', 'uploads'));
// bucket: Nome del contenitore remoto configurato per i media.
const bucket = process.env.MEDIA_S3_BUCKET?.trim();
// endpoint: Indirizzo del servizio di storage compatibile S3.
const endpoint = process.env.MEDIA_S3_ENDPOINT?.trim();
// s3: Client S3 attivo quando è configurato il contenitore remoto.
const s3 = bucket ? new S3Client({
    region: process.env.AWS_REGION || 'auto',
    endpoint: endpoint || undefined,
    // forcePathStyle: Usa il contenitore nel percorso dell’URL per gli endpoint S3 che lo richiedono.
    forcePathStyle: Boolean(endpoint),
    // requestChecksumCalculation: Stabilisce quando il client S3 deve calcolare i checksum delle richieste.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    // responseChecksumValidation: Stabilisce quando verificare i checksum restituiti dallo storage.
    responseChecksumValidation: 'WHEN_REQUIRED'
}) : null;

// safeMediaPath: Restituisce un percorso interno alla directory consentita oppure null se il nome non è sicuro.
// Riceve: dir (directory autorizzata); filename (nome del file).
function safeMediaPath(dir, filename) {
    if (typeof filename !== 'string' || filename.length > 255 || !/^[\w.-]+$/.test(filename)) return null;
    // resolved: Risultato della chiamata path.resolve, riutilizzato nelle istruzioni successive.
    const resolved = path.resolve(dir, filename);
    return path.dirname(resolved) === dir ? resolved : null;
}

// objectKey: Ricava la chiave S3 del media anteponendo la cartella logica degli upload al nome del file.
// Riceve: filename (nome del file).
function objectKey(filename) {
    return 'uploads/' + filename;
}

// mediaWritable: Indica se la configurazione permette di scrivere media nello storage disponibile.
function mediaWritable() {
    return Boolean(s3 || process.env.MEDIA_DIR || process.env.NODE_ENV !== 'production');
}

// storeMedia: Salva un upload su S3 o disco locale; sullo storage remoto coordina anche prenotazione e rilascio
// dello spazio.
// Riceve: file (file ricevuto o da elaborare).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function storeMedia(file) {
    // destination: Percorso locale validato in cui salvare il file.
    const destination = safeMediaPath(localDir, file.filename);
    if (!destination || !mediaWritable()) throw new Error('Storage upload non configurato.');
    if (s3) {
        // releaseReservation: Funzione che libera la prenotazione di spazio dopo l’esito definitivo dell’upload.
        const releaseReservation = await reserveMediaStorage(s3, bucket, objectKey(file.filename), file.size);
        // body: Stream di lettura del file temporaneo da trasferire allo storage.
        const body = createReadStream(file.path);
        // S3 can reject before opening the file: close the stream before temporary-file cleanup.
        // closed: Promise che permette di attendere la chiusura dello stream prima della pulizia del temporaneo.
        // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
        const closed = finished(body, { cleanup: true }).catch(() => {});
        try {
            await s3.send(new PutObjectCommand({
                Bucket: bucket,
                Key: objectKey(file.filename),
                Body: body,
                // ContentLength: Dimensione in byte del corpo da inviare allo storage.
                ContentLength: file.size,
                // ContentType: Tipo MIME da associare all’oggetto trasferito.
                ContentType: file.mimetype,
                // IfNoneMatch: Condizione HTTP usata per evitare di sovrascrivere un oggetto già presente.
                IfNoneMatch: '*'
            }));
            // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
            // Riceve: error (errore intercettato).
            if (releaseReservation) await releaseReservation().catch(error => {
                console.error('Pulizia prenotazione upload:', error.code || error.name);
            });
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            // status: Stato HTTP scelto per la risposta di errore.
            const status = error.$metadata?.httpStatusCode;
            // Keep reservations for uncertain network failures: the PUT may still commit on R2.
            if (releaseReservation && status >= 400 && status < 500 && status !== 408) {
                // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
                await releaseReservation().catch(() => {});
            }
            throw error;
        } finally {
            body.destroy();
            await closed;
        }
    } else {
        await fs.mkdir(localDir, { recursive: true });
        await fs.copyFile(file.path, destination, fs.constants.COPYFILE_EXCL);
    }
}

// findLocalFile: Cerca un file locale regolare nel percorso autorizzato, escludendo file assenti o non
// utilizzabili.
// Riceve: dir (directory autorizzata); filename (nome del file).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function findLocalFile(dir, filename) {
    // filePath: Percorso del file locale coinvolto nell’operazione.
    const filePath = safeMediaPath(dir, filename);
    if (!filePath) return null;
    try {
        return (await fs.lstat(filePath)).isFile() ? filePath : null;
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

// mediaExists: Verifica se il media esiste nello storage configurato o nelle directory locali previste.
// Riceve: filename (nome del file).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function mediaExists(filename) {
    if (!safeMediaPath(localDir, filename)) return false;
    if (s3) {
        try {
            await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(filename) }));
            return true;
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            if (error.$metadata?.httpStatusCode === 404) return false;
            throw error;
        }
    }
    return Boolean(await findLocalFile(localDir, filename));
}

// sendMedia: Trasmette il media nella risposta HTTP, gestendo anche le richieste di intervalli di byte.
// Riceve: req (richiesta HTTP); res (risposta HTTP); filename (nome del file); mimetype (tipo MIME del contenuto).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
// Completa la risposta HTTP con il contenuto o con lo stato di errore previsto.
async function sendMedia(req, res, filename, mimetype) {
    if (!safeMediaPath(localDir, filename)) return res.sendStatus(404);
    res.type(mimetype);

    if (s3) {
        // headOnly: Risultato del calcolo o del controllo applicato ai valori del blocco.
        const headOnly = req.method === 'HEAD';
        // range: Valore recuperato dalla raccolta indicizzata mediante la chiave.
        const range = req.get('range');
        // command: Valore scelto tra i due rami in base alla condizione indicata.
        const command = headOnly
            ? new HeadObjectCommand({ Bucket: bucket, Key: objectKey(filename) })
            : new GetObjectCommand({
                Bucket: bucket,
                Key: objectKey(filename),
                Range: /^bytes=(?:\d+-\d*|-\d+)$/.test(range || '') ? range : undefined
            });
        // object: Oggetto corrente restituito dall’elenco dello storage.
        // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
        // Riceve: error (errore intercettato).
        const object = await s3.send(command).catch(error => {
            if (error.$metadata?.httpStatusCode === 404) return null;
            throw error;
        });
        if (object) {
            if (object.ContentLength !== undefined) res.set('Content-Length', String(object.ContentLength));
            res.set('Accept-Ranges', 'bytes');
            if (object.ContentRange) res.status(206).set('Content-Range', object.ContentRange);
            if (headOnly) return res.end();
            return pipeline(object.Body, res);
        }
    }

    // filePath: Percorso del file locale coinvolto nell’operazione.
    const filePath = await findLocalFile(localDir, filename) || await findLocalFile(legacyDir, filename);
    if (!filePath) return res.sendStatus(404);
    // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
    // Riceve: resolve (completa la Promise con successo); reject (completa la Promise con errore).
    await new Promise((resolve, reject) => {
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: error (errore intercettato).
        res.sendFile(filePath, { cacheControl: false }, error => error ? reject(error) : resolve());
    });
}

// removeMedia: Rimuove il media dagli storage previsti senza cancellare percorsi costruiti da nomi non validi.
// Riceve: filename (nome del file).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function removeMedia(filename) {
    // localPath: Percorso controllato nello storage locale.
    const localPath = safeMediaPath(localDir, filename);
    // legacyPath: Percorso controllato nella vecchia directory degli upload.
    const legacyPath = safeMediaPath(legacyDir, filename);
    if (!localPath || !legacyPath) return;
    // unlink: Rimuove il file indicato; ignora soltanto il caso in cui il file non esiste.
    // Riceve: filePath (percorso del file).
    // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
    // Riceve: error (errore intercettato).
    const unlink = filePath => fs.unlink(filePath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
    });
    // operations: Operazioni asincrone da completare insieme.
    const operations = [...new Set([localPath, legacyPath])].map(unlink);
    if (s3) operations.push(s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(filename) })));
    await Promise.all(operations);
}

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = { legacyDir, mediaExists, mediaWritable, removeMedia, safeMediaPath, sendMedia, storeMedia };
