// Strumento da terminale per verificare o trasferire media già referenziati nel database; senza --apply esegue una
// simulazione.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// Carica le variabili di ambiente locali usate dalla configurazione del backend.
require('dotenv').config({ quiet: true });
// fs: Questa interfaccia del filesystem restituisce Promise utilizzabili con await.
const fs = require('node:fs/promises');
// path: path costruisce e verifica percorsi con i separatori corretti del sistema operativo.
const path = require('node:path');
// db: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece
// di aprirne una per richiesta.
const db = require('../config/db').promise();
// legacyDir: Directory storica degli upload esportata dal modulo di storage.
// mediaExists: Verifica se il media esiste nello storage configurato o nelle directory locali previste.
// safeMediaPath: Restituisce un percorso interno alla directory consentita oppure null se il nome non è sicuro.
// storeMedia: Salva un upload su S3 o disco locale; sullo storage remoto coordina anche prenotazione e rilascio
// dello spazio.
const { legacyDir, mediaExists, safeMediaPath, storeMedia } = require('../config/media-storage');
// fileSignatureMatches: Controlla i byte caratteristici del formato dichiarato; restituisce false per firme non
// riconosciute.
// mediaTypeForName: Ricava un MIME riconosciuto dall’estensione di un nome sicuro oppure restituisce null.
const { fileSignatureMatches, mediaTypeForName } = require('../config/upload');

// migrate: Esamina i media referenziati dal database e li trasferisce soltanto quando è presente l’opzione di
// applicazione.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
// Aggiorna il resoconto e lo stato di uscita del processo; non restituisce dati applicativi.
async function migrate() {
    // flags: Opzioni passate allo script dalla riga di comando.
    const flags = process.argv.slice(2);
    // apply: Indica se eseguire le scritture anziché limitarsi alla simulazione.
    const apply = flags.includes('--apply');
    // source: Primo elemento della raccolta che soddisfa il criterio richiesto.
    // Restituisce il criterio per individuare il primo elemento corrispondente.
    // Riceve: flag (opzione della riga di comando).
    const source = flags.find(flag => flag.startsWith('--source='));
    // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
    // Riceve: flag (opzione della riga di comando).
    if (flags.some(flag => flag !== '--apply' && flag !== source)) throw new Error('Argomenti non validi.');
    // sourceDir: Directory dalla quale cercare i file già esistenti.
    const sourceDir = source ? path.resolve(source.slice('--source='.length)) : legacyDir;
    // rows: Righe restituite dalla query o dal caricamento corrente.
    // Legge i dati necessari dal database.
    const [rows] = await db.query(
        'SELECT propic AS filename FROM users UNION SELECT propic FROM corsi UNION SELECT propic FROM gare UNION SELECT file_url FROM messages'
    );
    // bundled: Insieme degli asset già inclusi nel progetto, esclusi dal trasferimento dei media dinamici.
    const bundled = new Set(['default_user.png', 'default_corso.png', 'default_gara.png', 'boxe.jpg', 'giocoleria.jpg']);
    // report: Statistiche o resoconto che raccolgono l’esito dell’elaborazione.
    const report = { mode: apply ? 'apply' : 'dry-run', alreadyPresent: 0, ready: 0, copied: 0, missing: [], invalid: [] };
    // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
    // filename: Riferimento o risultato da valorizzare durante l’operazione.
    for (const { filename } of rows) {
        if (!filename || bundled.has(filename)) continue;
        // filePath: Percorso del file locale coinvolto nell’operazione.
        const filePath = safeMediaPath(sourceDir, filename);
        // mimetype: Risultato di mediaTypeForName. Ricava un MIME riconosciuto dall’estensione di un nome sicuro oppure
        // restituisce null.
        const mimetype = mediaTypeForName(filename);
        if (!filePath || !mimetype) {
            report.invalid.push(filename);
            continue;
        }
        if (await mediaExists(filename)) {
            report.alreadyPresent++;
            continue;
        }
        // info: Informazioni disponibili per il file, la connessione o la vista nel blocco corrente.
        // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
        // Riceve: error (errore intercettato).
        const info = await fs.lstat(filePath).catch(error => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (!info) {
            report.missing.push(filename);
            continue;
        }
        if (!info.isFile() || info.size > 10 * 1024 * 1024) {
            report.invalid.push(filename);
            continue;
        }
        // file: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const file = await fs.open(filePath, 'r');
        // signature: Firma del token o buffer contenente i byte iniziali del file.
        const signature = Buffer.alloc(32);
        // bytesRead: Numero di byte effettivamente letti dal file.
        let bytesRead;
        try {
            ({ bytesRead } = await file.read(signature, 0, signature.length, 0));
        } finally {
            await file.close();
        }
        if (!fileSignatureMatches(signature.subarray(0, bytesRead), mimetype)) {
            report.invalid.push(filename);
            continue;
        }
        report.ready++;
        if (apply) {
            await storeMedia({ filename, path: filePath, size: info.size, mimetype });
            report.copied++;
        }
    }
    console.log(JSON.stringify(report, null, 2));
    if (report.missing.length || report.invalid.length) process.exitCode = 2;
}

// Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
// Riceve: error (errore intercettato).
// Esegue la pulizia finale sia in caso di successo sia in caso di errore.
migrate().catch(error => {
    console.error('Migrazione upload interrotta:', error.code || error.name);
    process.exitCode = 1;
}).finally(() => db.end());
