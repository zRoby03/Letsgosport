// Test automatici Node.js: prepara dati o servizi di prova e verifica gli esiti tramite asserzioni.
// Mock e contesti isolati sostituiscono le risorse previste dalla prova; le pulizie registrate ripristinano lo
// stato al termine.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// assert: Le asserzioni fanno fallire il test quando risultato ed esito atteso non coincidono.
const assert = require('node:assert/strict');
// spawn: Avvia e controlla processi Node.js separati durante i test.
const { spawn } = require('node:child_process');
// randomBytes: Le API crittografiche producono valori casuali, impronte e firme usate nei controlli del progetto.
const { randomBytes } = require('node:crypto');
// once: Importa la dipendenza events utilizzata dalle operazioni di questo modulo.
const { once } = require('node:events');
// http: http crea il server HTTP o il servizio locale usato dalle prove.
const http = require('node:http');
// path: path costruisce e verifica percorsi con i separatori corretti del sistema operativo.
const path = require('node:path');
// test: Il test runner integrato di Node.js registra prove, simulazioni e pulizie a fine test.
const { test } = require('node:test');
// mysql: Importa la dipendenza mysql2/promise utilizzata dalle operazioni di questo modulo.
const mysql = require('mysql2/promise');

// sqlPort: Porta del database di test; la sua assenza fa saltare le integrazioni che la richiedono.
const sqlPort = Number(process.env.LGS_TEST_MYSQL_PORT);
// png: Risultato della chiamata Buffer.from, riutilizzato nelle istruzioni successive.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZd0AAAAASUVORK5CYII=', 'base64');

// timeout: Tempo massimo dell’operazione espresso in millisecondi.
// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// Riceve: t (contesto del test Node.js).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('quota R2: paginazione, upload simultanei, riavvio ed esiti incerti', { skip: !sqlPort, timeout: 45000 }, async t => {
    // database: Risultato del calcolo o del controllo applicato ai valori del blocco.
    const database = 'letsgosport_quota_' + randomBytes(6).toString('hex');
    // objects: Mappa che associa chiavi e valori per ricerche e aggiornamenti diretti.
    const objects = new Map([['other/a', Buffer.alloc(7)], ['other/b', Buffer.alloc(6)]]);
    // listDenied: Indicatore booleano che controlla la condizione descritta dal nome.
    let listDenied = false;
    // uncertainWrite: Indicatore booleano che controlla la condizione descritta dal nome.
    let uncertainWrite = false;
    // writeDenied: Indicatore booleano che controlla la condizione descritta dal nome.
    let writeDenied = false;
    // lastWrite: Riferimento o risultato da valorizzare durante l’operazione.
    let lastWrite;
    // putCount: Valore numerico o contatore iniziale utilizzato da questo blocco.
    let putCount = 0;
    // storage: Configurazione di archiviazione passata a Multer.
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: req (richiesta HTTP); res (risposta HTTP).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    const storage = http.createServer(async (req, res) => {
        // url: Indirizzo analizzato per distinguere origine, percorso e parametri.
        const url = new URL(req.url, 'http://localhost');
        if (url.searchParams.get('list-type') === '2') {
            if (listDenied) {
                res.writeHead(403, { 'Content-Type': 'application/xml' });
                return res.end('<Error><Code>AccessDenied</Code></Error>');
            }
            // keys: Risultato della chiamata .sort, riutilizzato nelle istruzioni successive.
            const keys = [...objects.keys()].sort();
            // offset: Valore convertito o normalizzato prima del suo utilizzo.
            const offset = Number(url.searchParams.get('continuation-token') || 0);
            // key: Valore della proprietà keys.offset, conservato per le operazioni successive.
            const key = keys[offset];
            // more: Risultato del calcolo o del controllo applicato ai valori del blocco.
            const more = offset + 1 < keys.length;
            res.setHeader('Content-Type', 'application/xml');
            return res.end('<ListBucketResult><Name>test-media</Name><IsTruncated>' + more + '</IsTruncated>' +
                (more ? '<NextContinuationToken>' + (offset + 1) + '</NextContinuationToken>' : '') +
                (key ? '<Contents><Key>' + key + '</Key><Size>' + objects.get(key).length + '</Size></Contents>' : '') +
                '</ListBucketResult>');
        }
        if (req.method === 'PUT') {
            putCount++;
            // chunks: Frammenti binari raccolti dal registratore o dallo stream.
            const chunks = [];
            // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
            // chunk: Riferimento o risultato da valorizzare durante l’operazione.
            for await (const chunk of req) chunks.push(chunk);
            lastWrite = { key: url.pathname.replace('/test-media/', ''), bytes: Buffer.concat(chunks) };
            // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
            // Riceve: resolve (completa la Promise con successo).
            await new Promise(resolve => setTimeout(resolve, 80));
            if (writeDenied) {
                res.writeHead(403, { 'Content-Type': 'application/xml' });
                return res.end('<Error><Code>AccessDenied</Code></Error>');
            }
            if (uncertainWrite) {
                res.writeHead(500, { 'Content-Type': 'application/xml' });
                return res.end('<Error><Code>InternalError</Code></Error>');
            }
            objects.set(lastWrite.key, lastWrite.bytes);
            res.setHeader('ETag', '"test-etag"');
            return res.end();
        }
        res.writeHead(404);
        res.end();
    }).listen(0, '127.0.0.1');
    // sql: Istruzione SQL da inviare al database.
    let sql;
    // child: Processo figlio del server avviato dalla prova automatica.
    let child;
    // base: Parte principale del nome ripulita oppure indirizzo base del server nel contesto del test.
    let base;
    // env: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
    const env = {
        ...process.env, NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: String(sqlPort),
        DB_USER: process.env.LGS_TEST_MYSQL_USER || 'root', DB_PASSWORD: process.env.LGS_TEST_MYSQL_PASSWORD || '',
        DB_NAME: database, DB_SSL: 'false',
        MEDIA_S3_BUCKET: 'test-media', AWS_REGION: 'auto', AWS_ACCESS_KEY_ID: 'test-key', AWS_SECRET_ACCESS_KEY: 'test-secret',
        MEDIA_STORAGE_LIMIT_BYTES: String(13 + png.length)
    };
    // stop: Ferma la risorsa simulata o di prova secondo l’implementazione del test.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async function stop() {
        if (!child || child.exitCode !== null || child.signalCode) return;
        // exited: Risultato della chiamata once, riutilizzato nelle istruzioni successive.
        const exited = once(child, 'exit');
        child.kill();
        await exited;
    }
    // launch: Avvia l’istanza server di prova con l’ambiente controllato del test.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async function launch() {
        // script: Codice del servizio di prova da eseguire in un processo separato.
        const script = `
            const express = require('express');
            const { uploadProfilo } = require('./config/upload');
            const app = express();
            app.get('/health', (req, res) => res.sendStatus(200));
            app.post('/upload', uploadProfilo, (req, res) => res.json({ filename: req.file.filename }));
            const server = app.listen(0, '127.0.0.1', () => console.log('READY ' + server.address().port));
        `;
        child = spawn(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), env, windowsHide: true });
        // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
        // Riceve: resolve (completa la Promise con successo); reject (completa la Promise con errore).
        base = await new Promise((resolve, reject) => {
            // output: Uscita o risultato raccolto nel contesto corrente.
            let output = '';
            // timer: Identificativo del temporizzatore, usato per annullarlo o gestirne la durata.
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            const timer = setTimeout(() => reject(new Error('Timeout avvio server quota')), 10000);
            // Raccoglie l’output del processo figlio per riconoscerne avvio ed errori.
            // Riceve: chunk (frammento ricevuto dallo stream).
            child.stdout.on('data', chunk => {
                output += chunk;
                // port: Valore della proprietà .exec.1, conservato per le operazioni successive.
                const port = /READY (\d+)/.exec(output)?.[1];
                if (port) { clearTimeout(timer); resolve('http://127.0.0.1:' + port); }
            });
            // Raccoglie l’output del processo figlio per riconoscerne avvio ed errori.
            // Riceve: chunk (frammento ricevuto dallo stream).
            child.stderr.on('data', chunk => { output += chunk; });
            // Reagisce all’evento exit aggiornando i dati o i controlli previsti.
            // Riceve: code (codice tecnico dell’errore).
            child.once('exit', code => { clearTimeout(timer); reject(new Error('Server quota terminato: ' + code + ' ' + output)); });
        });
    }
    // upload: Invia il file di prova al server per verificare quota e comportamento dell’upload.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async function upload() {
        // form: Modulo HTML da leggere o da aggiornare.
        const form = new FormData();
        form.append('immagine', new Blob([png], { type: 'image/png' }), 'profile.png');
        // response: Risposta ricevuta dal backend o dal servizio esterno.
        // method: Metodo HTTP che identifica l’operazione richiesta al backend.
        const response = await fetch(base + '/upload', { method: 'POST', body: form });
        return { status: response.status, data: await response.json() };
    }
    // Ripristina ambiente e risorse al termine del test, anche in caso di fallimento.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    t.after(async () => {
        await stop();
        storage.closeAllConnections();
        // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
        // Riceve: resolve (completa la Promise con successo).
        await new Promise(resolve => storage.close(resolve));
        if (sql) { await sql.query('DROP DATABASE IF EXISTS ' + database); await sql.end(); }
    });
    await once(storage, 'listening');
    env.MEDIA_S3_ENDPOINT = 'http://127.0.0.1:' + storage.address().port;
    sql = await mysql.createConnection({ host: env.DB_HOST, port: sqlPort, user: env.DB_USER, password: env.DB_PASSWORD });
    await sql.query('CREATE DATABASE ' + database);
    await launch();
    // results: Risultati consegnati dall’operazione asincrona.
    const results = await Promise.all([upload(), upload()]);
    // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
    // Riceve: result (esito dell’operazione).
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    // Restituisce il criterio per individuare il primo elemento corrispondente.
    // Riceve: result (esito dell’operazione).
    assert.match(results.find(result => result.status === 409).data.errore, /Spazio disponibile/);
    assert.equal(putCount, 1);
    // successful: Valore della proprietà results.find.data.filename, conservato per le operazioni successive.
    // Restituisce il criterio per individuare il primo elemento corrispondente.
    // Riceve: result (esito dell’operazione).
    const successful = results.find(result => result.status === 200).data.filename;
    assert.deepEqual(objects.get('uploads/' + successful), png);
    await stop();
    await launch();
    assert.equal((await upload()).status, 409);
    assert.equal(putCount, 1);
    listDenied = true;
    assert.equal((await upload()).status, 503);
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal(putCount, 1);
    listDenied = false;
    objects.delete('uploads/' + successful);
    writeDenied = true;
    assert.equal((await upload()).status, 503);
    writeDenied = false;
    uncertainWrite = true;
    assert.equal((await upload()).status, 503);
    // failedWriteCount: Riferimento al valore putCount utilizzato da questo blocco.
    const failedWriteCount = putCount;
    // delayed: Riferimento al valore lastWrite utilizzato da questo blocco.
    const delayed = lastWrite;
    await stop();
    await launch();
    uncertainWrite = false;
    assert.equal((await upload()).status, 409);
    assert.equal(putCount, failedWriteCount);
    objects.set(delayed.key, delayed.bytes);
    await stop();
    env.MEDIA_STORAGE_LIMIT_BYTES = String(13 + 2 * png.length);
    await launch();
    assert.equal((await upload()).status, 200);
    // Aggiorna il valore accumulato usando l’elemento corrente.
    // Riceve: total (valore accumulato); bytes (dimensione in byte).
    assert.equal([...objects.values()].reduce((total, bytes) => total + bytes.length, 0), 13 + 2 * png.length);
});
