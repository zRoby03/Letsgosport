// Test automatici Node.js: prepara dati o servizi di prova e verifica gli esiti tramite asserzioni.
// Mock e contesti isolati sostituiscono le risorse previste dalla prova; le pulizie registrate ripristinano lo
// stato al termine.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// assert: Le asserzioni fanno fallire il test quando risultato ed esito atteso non coincidono.
const assert = require('node:assert/strict');
// spawn: Avvia e controlla processi Node.js separati durante i test.
// execFile: Avvia e controlla processi Node.js separati durante i test.
const { spawn, execFile } = require('node:child_process');
// randomBytes: Le API crittografiche producono valori casuali, impronte e firme usate nei controlli del progetto.
// randomUUID: Le API crittografiche producono valori casuali, impronte e firme usate nei controlli del progetto.
const { randomBytes, randomUUID } = require('node:crypto');
// once: Importa la dipendenza events utilizzata dalle operazioni di questo modulo.
const { once } = require('node:events');
// fs: Questa interfaccia del filesystem restituisce Promise utilizzabili con await.
const fs = require('node:fs/promises');
// os: os fornisce informazioni del sistema, inclusa la directory dei file temporanei.
const os = require('node:os');
// path: path costruisce e verifica percorsi con i separatori corretti del sistema operativo.
const path = require('node:path');
// test: Il test runner integrato di Node.js registra prove, simulazioni e pulizie a fine test.
const { test } = require('node:test');
// promisify: Importa la dipendenza util utilizzata dalle operazioni di questo modulo.
const { promisify } = require('node:util');
// bcrypt: bcrypt calcola e verifica hash delle password senza richiedere di salvarle in chiaro.
const bcrypt = require('bcrypt');
// mysql: Importa la dipendenza mysql2/promise utilizzata dalle operazioni di questo modulo.
const mysql = require('mysql2/promise');
// io: Il client Socket.IO permette ai test di simulare un browser collegato al server.
const { io } = require('socket.io-client');

// root: Risultato della chiamata path.resolve, riutilizzato nelle istruzioni successive.
const root = path.resolve(__dirname, '..');
// exec: Risultato della chiamata promisify, riutilizzato nelle istruzioni successive.
const exec = promisify(execFile);
// png: Risultato della chiamata Buffer.from, riutilizzato nelle istruzioni successive.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZd0AAAAASUVORK5CYII=', 'base64');
// sqlPort: Porta del database di test; la sua assenza fa saltare le integrazioni che la richiedono.
const sqlPort = Number(process.env.LGS_TEST_MYSQL_PORT);

// launchServer: Avvia un processo server di test e attende il segnale che è pronto.
// Riceve: env (variabili di ambiente del processo di prova).
function launchServer(env) {
    // child: Processo figlio del server avviato dalla prova automatica.
    const child = spawn(process.execPath, ['server.js'], { cwd: root, env, windowsHide: true });
    // ready: Promise che rappresenta il completamento futuro dell’operazione.
    // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
    // Riceve: resolve (completa la Promise con successo); reject (completa la Promise con errore).
    const ready = new Promise((resolve, reject) => {
        // timer: Identificativo del temporizzatore, usato per annullarlo o gestirne la durata.
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        const timer = setTimeout(() => reject(new Error('Timeout avvio server di test')), 15000);
        // output: Uscita o risultato raccolto nel contesto corrente.
        let output = '';
        // Raccoglie l’output del processo figlio per riconoscerne avvio ed errori.
        // Riceve: chunk (frammento ricevuto dallo stream).
        child.stdout.on('data', chunk => {
            output += chunk;
            // port: Valore della proprietà .exec.1, conservato per le operazioni successive.
            const port = /Server attivo sulla porta (\d+)/.exec(output)?.[1];
            if (port) {
                clearTimeout(timer);
                resolve('http://127.0.0.1:' + port);
            }
        });
        // Raccoglie l’output del processo figlio per riconoscerne avvio ed errori.
        // Riceve: chunk (frammento ricevuto dallo stream).
        child.stderr.on('data', chunk => { output += chunk; });
        // Reagisce all’evento exit aggiornando i dati o i controlli previsti.
        // Riceve: code (codice tecnico dell’errore).
        child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error('Server terminato (' + code + '): ' + output));
        });
    });
    return { child, ready };
}

// stopServer: Termina il processo server avviato dal test e attende la sua chiusura.
// Riceve: instance (istanza server di prova).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function stopServer(instance) {
    if (instance.child.exitCode !== null || instance.child.signalCode) return;
    // exited: Risultato della chiamata once, riutilizzato nelle istruzioni successive.
    const exited = once(instance.child, 'exit');
    instance.child.kill();
    await exited;
}

// login: Esegue il login dell’account di prova e recupera i dati di autenticazione necessari al test.
// Riceve: base (indirizzo base del server di prova); email (indirizzo dell’account); password (valore da
// verificare o elaborare).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function login(base, email, password) {
    // response: Risposta ricevuta dal backend o dal servizio esterno.
    const response = await fetch(base + '/api/login', {
        // method: Metodo HTTP che identifica l’operazione richiesta al backend.
        method: 'POST',
        // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, recaptchaToken: 'local-dev-recaptcha-ok' })
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.get('set-cookie').split(';', 1)[0];
}

// timeout: Tempo massimo dell’operazione espresso in millisecondi.
// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// Riceve: t (contesto del test Node.js).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('upload privati, migrazione, invio idempotente e revoca dopo riavvio', { skip: !sqlPort, timeout: 45000 }, async t => {
    // dir: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'letsgosport-test-'));
    // database: Risultato del calcolo o del controllo applicato ai valori del blocco.
    const database = 'letsgosport_test_' + randomBytes(6).toString('hex');
    // env: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
    const env = {
        ...process.env,
        NODE_ENV: 'test', PORT: '0',
        DB_HOST: '127.0.0.1', DB_PORT: String(sqlPort),
        DB_USER: process.env.LGS_TEST_MYSQL_USER || 'root',
        DB_PASSWORD: process.env.LGS_TEST_MYSQL_PASSWORD || '',
        DB_SSL: 'false', DB_NAME: database,
        SESSION_SECRET: randomBytes(32).toString('hex'),
        MEDIA_S3_BUCKET: '', MEDIA_DIR: path.join(dir, 'stored'),
        TURN_KEY_ID: '', TURN_KEY_API_TOKEN: '', TURN_URLS: '', TURN_SHARED_SECRET: ''
    };
    // sql: Istruzione SQL da inviare al database.
    let sql;
    // server: Server che riceve le connessioni HTTP e ospita Socket.IO quando previsto.
    let server;
    // socket: Connessione Socket.IO condivisa con il client o con gli altri moduli del frontend.
    let socket;
    // Ripristina ambiente e risorse al termine del test, anche in caso di fallimento.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    t.after(async () => {
        socket?.close();
        if (server) await stopServer(server);
        if (sql) {
            await sql.query('DROP DATABASE IF EXISTS ' + database);
            await sql.end();
        }
        await fs.rm(dir, { recursive: true, force: true });
    });

    sql = await mysql.createConnection({
        host: env.DB_HOST, port: sqlPort, user: env.DB_USER, password: env.DB_PASSWORD,
        multipleStatements: true
    });
    // quote: Valore convertito o normalizzato prima del suo utilizzo.
    const quote = String.fromCharCode(96);
    // schema: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const schema = await fs.readFile(path.join(root, 'database/consegna_universitaria.sql'), 'utf8');
    await sql.query(schema.replaceAll(quote + 'letsgosport' + quote, quote + database + quote));
    // quotaMigration: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const quotaMigration = await fs.readFile(path.join(root, 'database/migrations/004_media_storage_quota.sql'), 'utf8');
    await sql.query(quotaMigration);
    await sql.query(quotaMigration);

    // password: Password mantenuta in memoria per la validazione o il confronto con l’hash.
    const password = randomBytes(16).toString('hex');
    // hash: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    // Calcola l’hash bcrypt prima del salvataggio della password.
    const hash = await bcrypt.hash(password, 4);
    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    await sql.execute(
        "INSERT INTO users (email,password,ruolo,nome,cognome) VALUES ('coach@example.test',?,'COACH','Coach','Test'),('member@example.test',?,'PARTNER','Member','Test'),('outsider@example.test',?,'PARTNER','Outsider','Test'),('admin@example.test',?,'ADMIN','Admin','Test')",
        [hash, hash, hash, hash]
    );
    // users: Elenco degli utenti restituiti dal caricamento.
    // Legge i dati necessari dal database.
    const [users] = await sql.query("SELECT id FROM users WHERE email IN ('coach@example.test','member@example.test') ORDER BY id");
    // room: Identificativo della stanza su cui opera questo blocco.
    // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
    // Riceve: user (dati dell’utente).
    const room = 'private_' + users.map(user => user.id).join('_');
    server = launchServer(env);
    // base: Parte principale del nome ripulita oppure indirizzo base del server nel contesto del test.
    let base = await server.ready;
    // coach: Informazione del coach assegnato, usata nella rappresentazione del corso.
    // member: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    // outsider: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    // admin: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const [coach, member, outsider, admin] = await Promise.all(['coach', 'member', 'outsider', 'admin']
        // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
        // Riceve: name (nome da utilizzare).
        .map(name => login(base, name + '@example.test', password)));
    assert.equal((await fetch(base + '/api/chiamate/ice')).status, 401);
    // ice: Risultato della richiesta HTTP attesa prima di proseguire.
    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
    const ice = await fetch(base + '/api/chiamate/ice', { headers: { Cookie: member } });
    assert.equal(ice.status, 200);
    assert.match(ice.headers.get('cache-control'), /no-store/);
    // iceServers: Server STUN/TURN usati dal browser per trovare i percorsi di rete della chiamata.
    assert.deepEqual(await ice.json(), { iceServers: [] });
    // courseName: Testo o valore iniziale utilizzato da questo blocco.
    const courseName = 'Mobilit\u00e0 e benessere \ud83c\udfc3';
    // raceName: Testo o valore iniziale utilizzato da questo blocco.
    const raceName = 'Gara citt\u00e0 \ud83c\udfc5';
    // preview: Testo o valore iniziale utilizzato da questo blocco.
    const preview = 'Caff\u00e8 e sport \ud83d\udcac';
    // course: Dati del corso corrente.
    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    const [course] = await sql.execute(
        "INSERT INTO corsi (nome,orario_inizio,durata,giorno,coach_id) VALUES (?,'10:00',60,'Lunedi',?)",
        [courseName, users[0].id]
    );
    // race: Dati della gara corrente.
    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    const [race] = await sql.execute("INSERT INTO gare (nome,giorno,orario) VALUES (?,'2027-01-01','10:00')", [raceName]);
    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    await sql.execute('INSERT INTO enrollments_corsi (user_id,corso_id) VALUES (?,?)', [users[1].id, course.insertId]);
    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    await sql.execute('INSERT INTO enrollments_gare (user_id,gara_id) VALUES (?,?),(?,?)',
        [users[0].id, race.insertId, users[1].id, race.insertId]);
    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    await sql.execute("INSERT INTO messages (user_id,room,contenuto) VALUES (?,'general',?)", [users[0].id, preview]);
    // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
    // cookie: Cookie della sessione mantenuto dal client o dal test.
    for (const cookie of [coach, member, admin, outsider]) {
        // response: Risposta ricevuta dal backend o dal servizio esterno.
        // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
        const response = await fetch(base + '/api/chat/stanze', { headers: { Cookie: cookie } });
        assert.equal(response.status, 200, await response.clone().text());
        // rooms: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const rooms = await response.json();
        // Restituisce il criterio per individuare il primo elemento corrispondente.
        // Riceve: item (elemento corrente).
        assert.equal(rooms.find(item => item.room_id === 'general').last_message_preview, preview);
        // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
        // Riceve: item (elemento corrente).
        assert.equal(rooms.some(item => item.nome === courseName), cookie !== outsider);
        // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
        // Riceve: item (elemento corrente).
        assert.equal(rooms.some(item => item.nome === raceName), cookie !== outsider);
    }
    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
    assert.equal((await fetch(base + '/api/admin/utenti', { headers: { Cookie: member } })).status, 403);
    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
    assert.equal((await fetch(base + '/api/coach/corsi', { headers: { Cookie: coach } })).status, 200);
    // privateChat: Risultato della richiesta HTTP attesa prima di proseguire.
    const privateChat = await fetch(base + '/api/chat/private/' + users[0].id, {
        // method: Metodo HTTP che identifica l’operazione richiesta al backend.
        // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
        method: 'POST', headers: { Cookie: member }
    });
    assert.equal(privateChat.status, 200, await privateChat.clone().text());
    assert.deepEqual(await privateChat.json(), { room });
    // rooms: Risultato della richiesta HTTP attesa prima di proseguire.
    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
    const rooms = await fetch(base + '/api/chat/stanze', { headers: { Cookie: member } });
    assert.equal(rooms.status, 200);
    // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
    // Riceve: stanza (dati della stanza).
    assert.ok((await rooms.json()).some(stanza => stanza.room_id === room));
    // photoForm: Dati multipart del form, adatti anche al trasferimento di file.
    const photoForm = new FormData();
    photoForm.append('immagine', new Blob([png], { type: 'image/png' }), 'profile.png');
    // photo: Risultato della richiesta HTTP attesa prima di proseguire.
    const photo = await fetch(base + '/api/profilo/propic', {
        // method: Metodo HTTP che identifica l’operazione richiesta al backend.
        // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
        method: 'POST', headers: { Cookie: member }, body: photoForm
    });
    assert.equal(photo.status, 200, await photo.clone().text());
    // propic: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const { propic } = await photo.json();

    // form: Modulo HTML da leggere o da aggiornare.
    const form = new FormData();
    form.append('file_chat', new Blob([png], { type: 'image/png' }), 'qa.png');
    // upload: Risultato della richiesta HTTP attesa prima di proseguire.
    const upload = await fetch(base + '/api/chat/upload?room=' + room, {
        // method: Metodo HTTP che identifica l’operazione richiesta al backend.
        // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
        method: 'POST', headers: { Cookie: coach }, body: form
    });
    assert.equal(upload.status, 200, await upload.clone().text());
    // attachment: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const attachment = await upload.json();
    assert.equal((await fetch(base + '/uploads/' + attachment.file_url)).status, 404);
    assert.equal((await fetch(base + '/%75ploads/' + attachment.file_url)).status, 404);

    socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: coach }, reconnection: false });
    await once(socket, 'connect');
    // received: Risultato della chiamata once, riutilizzato nelle istruzioni successive.
    const received = once(socket, 'receive_message');
    socket.emit('send_message', { room, ...attachment });
    // message: Messaggio di stato o contenuto da rappresentare.
    const [message] = await received;
    // delivery: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
    const delivery = { room, contenuto: 'Prova con conferma', client_id: randomUUID() };
    // firstAck: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const firstAck = await socket.timeout(3000).emitWithAck('send_message', delivery);
    assert.equal(firstAck.ok, true);
    socket.close();
    // url: Risultato del calcolo o del controllo applicato ai valori del blocco.
    const url = '/api/chat/allegati/' + message.id;
    assert.equal((await fetch(base + url)).status, 401);
    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
    assert.equal((await fetch(base + url, { headers: { Cookie: outsider } })).status, 404);
    // download: Risultato della richiesta HTTP attesa prima di proseguire.
    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
    const download = await fetch(base + url, { headers: { Cookie: member, Range: 'bytes=0-7' } });
    assert.equal(download.status, 206);
    assert.match(download.headers.get('cache-control'), /no-store/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), png.subarray(0, 8));

    // legacyName: Testo o valore iniziale utilizzato da questo blocco.
    const legacyName = '1731000000000_0123456789abcdef_legacy.png';
    await fs.writeFile(path.join(dir, legacyName), png);
    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    await sql.execute('INSERT INTO messages (user_id,room,contenuto,file_url,file_type) VALUES (?,?,?,?,?)',
        [users[0].id, room, '', legacyName, 'image/png']);
    // dryRun: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const dryRun = await exec(process.execPath, ['scripts/migrate-media.js', '--source=' + dir], { cwd: root, env });
    assert.equal(JSON.parse(dryRun.stdout).ready, 1);
    await assert.rejects(fs.stat(path.join(env.MEDIA_DIR, legacyName)), { code: 'ENOENT' });
    // migrated: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const migrated = await exec(process.execPath, ['scripts/migrate-media.js', '--source=' + dir, '--apply'], { cwd: root, env });
    assert.equal(JSON.parse(migrated.stdout).copied, 1);
    assert.deepEqual(await fs.readFile(path.join(env.MEDIA_DIR, legacyName)), png);

    await stopServer(server);
    server = launchServer(env);
    base = await server.ready;
    // afterRestart: Risultato della richiesta HTTP attesa prima di proseguire.
    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
    const afterRestart = await fetch(base + url, { headers: { Cookie: member } });
    assert.equal(afterRestart.status, 200);
    assert.deepEqual(Buffer.from(await afterRestart.arrayBuffer()), png);
    // photoAfterRestart: Risultato della richiesta HTTP attesa prima di proseguire.
    const photoAfterRestart = await fetch(base + '/uploads/' + encodeURIComponent(propic));
    assert.equal(photoAfterRestart.status, 200);
    assert.deepEqual(Buffer.from(await photoAfterRestart.arrayBuffer()), png);

    socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: coach }, reconnection: false });
    await once(socket, 'connect');
    // repeatedAck: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const repeatedAck = await socket.timeout(3000).emitWithAck('send_message', delivery);
    assert.deepEqual(repeatedAck, firstAck);
    // count: Contatore degli elementi o eventi elaborati dal blocco.
    // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
    const [[count]] = await sql.execute('SELECT COUNT(*) AS n FROM messages WHERE client_id = ?', [delivery.client_id]);
    assert.equal(count.n, 1);

    // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
    await sql.query('INSERT INTO messages (user_id,room,contenuto,data_invio) VALUES ?', [
        // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
        // Riceve: _ (parametro non utilizzato); index (posizione nell’elenco).
        Array.from({ length: 55 }, (_, index) => [users[0].id, room, 'Storico ' + index, new Date('2025-02-01T12:00:00Z')])
    ]);
    // firstPage: Risultato della chiamata once, riutilizzato nelle istruzioni successive.
    const firstPage = once(socket, 'room_history');
    socket.emit('join_room', room);
    // messages: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    // metadata: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const [messages, metadata] = await firstPage;
    assert.equal(messages.length, 50);
    assert.deepEqual(metadata, { room, hasMore: true });
    // older: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const older = await socket.timeout(3000).emitWithAck('load_room_history', { room, beforeId: messages[0].id });
    assert.equal(older.hasMore, false);
    assert.equal(older.messages.length, 8);
    // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
    // Riceve: message (testo del messaggio).
    assert.equal(new Set([...older.messages, ...messages].map(message => message.id)).size, 58);

    // disconnected: Risultato della chiamata once, riutilizzato nelle istruzioni successive.
    const disconnected = once(socket, 'disconnect');
    // demoted: Risultato della richiesta HTTP attesa prima di proseguire.
    const demoted = await fetch(base + '/api/admin/utenti/' + users[0].id, {
        // method: Metodo HTTP che identifica l’operazione richiesta al backend.
        method: 'PUT',
        // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
        headers: { Cookie: admin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'Coach', cognome: 'Test', eta: 25, ruolo: 'PARTNER', bio: '', certificato_scadenza: '' })
    });
    assert.equal(demoted.status, 200, await demoted.clone().text());
    await disconnected;
    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
    assert.equal((await fetch(base + '/api/coach/corsi', { headers: { Cookie: coach } })).status, 403);
    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
    assert.equal((await fetch(base + '/api/profilo', { headers: { Cookie: coach } })).status, 401);
    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
    assert.equal((await fetch(base + url, { headers: { Cookie: member } })).status, 404);
});
