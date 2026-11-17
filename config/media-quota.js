// Coordina database e storage S3 per prenotare spazio prima degli upload, anche con richieste simultanee.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// createHash: Costruisce l’hash usato per identificare dati senza conservarne la rappresentazione originale.
const { createHash } = require('node:crypto');
// ListObjectsV2Command: Comando che legge una pagina degli oggetti presenti nel contenitore.
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

// schemaReady: Promise condivisa della preparazione della tabella delle prenotazioni.
let schemaReady;

// quotaError: Costruisce un errore con codice tecnico e messaggio generico relativo alla quota.
// Riceve: code (codice tecnico dell’errore).
function quotaError(code) {
    // Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
    return Object.assign(new Error('Quota archiviazione non disponibile.'), { code });
}

// getStorageLimitBytes: Restituisce il limite di spazio in byte e rifiuta configurazioni che non sono interi
// positivi sicuri.
// Restituisce il numero massimo di byte; una configurazione non valida solleva un errore.
function getStorageLimitBytes() {
    // configured: Valore della quota letto dall’ambiente prima del controllo numerico.
    const configured = process.env.MEDIA_STORAGE_LIMIT_BYTES;
    // limit: Soglia massima prevista per il controllo corrente.
    const limit = configured === undefined || configured.trim() === '' ? 8000000000 : Number(configured);
    // Rifiuta lo stato non valido sollevando l’errore previsto, senza proseguire con le operazioni successive.
    if (!Number.isSafeInteger(limit) || limit < 1) throw quotaError('MEDIA_INVALID_STORAGE_LIMIT');
    return limit;
}

// reserveMediaStorage: Prenota spazio con un lock nel database; confronta oggetti S3 e prenotazioni e restituisce
// una funzione di rilascio.
// Riceve: s3 (client dello storage compatibile S3); bucket (contenitore dello storage); objectKey (chiave
// dell’oggetto nello storage); size (dimensione in byte).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
// La Promise restituisce la funzione asincrona da chiamare per liberare la prenotazione.
async function reserveMediaStorage(s3, bucket, objectKey, size) {
    // limit: Soglia massima prevista per il controllo corrente.
    const limit = getStorageLimitBytes();
    if (!Number.isSafeInteger(size) || size < 0) {
        throw quotaError('MEDIA_INVALID_STORAGE_LIMIT');
    }
    // Rifiuta lo stato non valido sollevando l’errore previsto, senza proseguire con le operazioni successive.
    if (size > limit) throw quotaError('MEDIA_STORAGE_QUOTA_EXCEEDED');

    // pool: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate
    // invece di aprirne una per richiesta.
    const pool = require('./db').promise();
    if (!schemaReady) {
        // Prepara la struttura SQL se prevista dall’istruzione.
        schemaReady = pool.query(`CREATE TABLE IF NOT EXISTS media_upload_reservations (
            bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            size_bytes BIGINT UNSIGNED NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (bucket_key, object_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
            // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
            // Riceve: error (errore intercettato).
            .catch(error => { schemaReady = undefined; throw error; });
    }
    await schemaReady;
    // bucketKey: Impronta del nome del contenitore usata come chiave tecnica nel database.
    const bucketKey = createHash('sha256').update(bucket).digest('hex');
    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    await pool.execute('INSERT IGNORE INTO media_upload_reservations (bucket_key,object_key,size_bytes) VALUES (?,\'\',0)', [bucketKey]);
    // connection: Connessione acquisita per mantenere coerenti le operazioni del blocco.
    const connection = await pool.getConnection();
    try {
        // Avvia la transazione con le opzioni di lock previste.
        await connection.query('BEGIN /*T! PESSIMISTIC */');
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        await connection.execute('SELECT size_bytes FROM media_upload_reservations WHERE bucket_key=? AND object_key=\'\' FOR UPDATE', [bucketKey]);
        // rows: Righe restituite dalla query o dal caricamento corrente.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const [rows] = await connection.execute('SELECT object_key,size_bytes FROM media_upload_reservations WHERE bucket_key=? AND object_key<>\'\' FOR UPDATE', [bucketKey]);
        // pending: Prenotazioni non ancora riconciliate con gli oggetti presenti nello storage.
        // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
        // Riceve: row (riga del risultato).
        const pending = new Map(rows.map(row => [row.object_key, Number(row.size_bytes)]));
        // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
        // Riceve: bytes (dimensione in byte).
        if ([...pending.values()].some(bytes => !Number.isSafeInteger(bytes) || bytes < 0)) {
            throw quotaError('MEDIA_INVALID_STORAGE_USAGE');
        }
        // used: Spazio già occupato dagli oggetti elencati nello storage.
        let used = 0;
        // continuation: Cursore della pagina successiva nell’elenco degli oggetti S3.
        let continuation;
        // seen: Insieme dei cursori già incontrati per riconoscere paginazioni non valide.
        const seen = new Set();
        // Ripete il blocco finché la condizione di controllo lo permette.
        do {
            // page: Pagina corrente di risultati o riferimento alla pagina in elaborazione.
            const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuation }),
                { abortSignal: AbortSignal.timeout(10000) });
            if (page.Name !== bucket || typeof page.IsTruncated !== 'boolean') {
                throw quotaError('MEDIA_INVALID_STORAGE_USAGE');
            }
            // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
            // object: Oggetto corrente restituito dall’elenco dello storage.
            for (const object of page.Contents || []) {
                // bytes: Dimensione in byte dell’elemento corrente.
                const bytes = Number(object.Size);
                if (typeof object.Key !== 'string' || !Number.isSafeInteger(bytes) || bytes < 0) {
                    throw quotaError('MEDIA_INVALID_STORAGE_USAGE');
                }
                used += bytes;
                pending.delete(object.Key);
            }
            // Rifiuta lo stato non valido sollevando l’errore previsto, senza proseguire con le operazioni successive.
            if (used + size > limit) throw quotaError('MEDIA_STORAGE_QUOTA_EXCEEDED');
            continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
            if (page.IsTruncated && (typeof continuation !== 'string' || !continuation || seen.has(continuation))) {
                throw quotaError('MEDIA_INVALID_STORAGE_USAGE');
            }
            if (continuation) seen.add(continuation);
        } while (continuation);
        // reserved: Spazio delle prenotazioni che deve ancora essere conteggiato.
        // Aggiorna il valore accumulato usando l’elemento corrente.
        // Riceve: total (valore accumulato); bytes (dimensione in byte).
        const reserved = [...pending.values()].reduce((total, bytes) => total + bytes, 0);
        // Rifiuta lo stato non valido sollevando l’errore previsto, senza proseguire con le operazioni successive.
        if (used + reserved + size > limit) throw quotaError('MEDIA_STORAGE_QUOTA_EXCEEDED');
        // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
        await connection.execute('INSERT INTO media_upload_reservations (bucket_key,object_key,size_bytes) VALUES (?,?,?)',
            [bucketKey, objectKey, size]);
        // Conferma definitivamente le modifiche della transazione.
        await connection.commit();
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        // Annulla le modifiche non confermate della transazione.
        // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        // Restituisce la connessione al pool, rendendola riutilizzabile.
        connection.release();
    }

    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    return async () => {
        // Elimina i record individuati dalle condizioni della query; i segnaposto ? ricevono i valori separati dai
        // parametri.
        await pool.execute('DELETE FROM media_upload_reservations WHERE bucket_key=? AND object_key=?', [bucketKey, objectKey]);
    };
}

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = { getStorageLimitBytes, reserveMediaStorage };
