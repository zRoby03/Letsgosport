const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const { io } = require('socket.io-client');

const root = path.resolve(__dirname, '..');
const exec = promisify(execFile);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZd0AAAAASUVORK5CYII=', 'base64');
const sqlPort = Number(process.env.LGS_TEST_MYSQL_PORT);

function launchServer(env) {
    const child = spawn(process.execPath, ['server.js'], { cwd: root, env, windowsHide: true });
    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout avvio server di test')), 15000);
        let output = '';
        child.stdout.on('data', chunk => {
            output += chunk;
            const port = /Server attivo sulla porta (\d+)/.exec(output)?.[1];
            if (port) {
                clearTimeout(timer);
                resolve('http://127.0.0.1:' + port);
            }
        });
        child.stderr.on('data', chunk => { output += chunk; });
        child.once('exit', code => {
            clearTimeout(timer);
            reject(new Error('Server terminato (' + code + '): ' + output));
        });
    });
    return { child, ready };
}

async function stopServer(instance) {
    if (instance.child.exitCode !== null || instance.child.signalCode) return;
    const exited = once(instance.child, 'exit');
    instance.child.kill();
    await exited;
}

async function login(base, email, password) {
    const response = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, recaptchaToken: 'local-dev-recaptcha-ok' })
    });
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.get('set-cookie').split(';', 1)[0];
}

test('upload privati, migrazione, invio idempotente e revoca dopo riavvio', { skip: !sqlPort, timeout: 45000 }, async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'letsgosport-test-'));
    const database = 'letsgosport_test_' + randomBytes(6).toString('hex');
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
    let sql;
    let server;
    let socket;
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
    const quote = String.fromCharCode(96);
    const schema = await fs.readFile(path.join(root, 'database/consegna_universitaria.sql'), 'utf8');
    await sql.query(schema.replaceAll(quote + 'letsgosport' + quote, quote + database + quote));
    const quotaMigration = await fs.readFile(path.join(root, 'database/migrations/004_media_storage_quota.sql'), 'utf8');
    await sql.query(quotaMigration);
    await sql.query(quotaMigration);

    const password = randomBytes(16).toString('hex');
    const hash = await bcrypt.hash(password, 4);
    await sql.execute(
        "INSERT INTO users (email,password,ruolo,nome,cognome) VALUES ('coach@example.test',?,'COACH','Coach','Test'),('member@example.test',?,'PARTNER','Member','Test'),('outsider@example.test',?,'PARTNER','Outsider','Test'),('admin@example.test',?,'ADMIN','Admin','Test')",
        [hash, hash, hash, hash]
    );
    const [users] = await sql.query("SELECT id FROM users WHERE email IN ('coach@example.test','member@example.test') ORDER BY id");
    const room = 'private_' + users.map(user => user.id).join('_');
    server = launchServer(env);
    let base = await server.ready;
    const [coach, member, outsider, admin] = await Promise.all(['coach', 'member', 'outsider', 'admin']
        .map(name => login(base, name + '@example.test', password)));
    assert.equal((await fetch(base + '/api/chiamate/ice')).status, 401);
    const ice = await fetch(base + '/api/chiamate/ice', { headers: { Cookie: member } });
    assert.equal(ice.status, 200);
    assert.match(ice.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await ice.json(), { iceServers: [] });
    const courseName = 'Mobilit\u00e0 e benessere \ud83c\udfc3';
    const raceName = 'Gara citt\u00e0 \ud83c\udfc5';
    const preview = 'Caff\u00e8 e sport \ud83d\udcac';
    const [course] = await sql.execute(
        "INSERT INTO corsi (nome,orario_inizio,durata,giorno,coach_id) VALUES (?,'10:00',60,'Lunedi',?)",
        [courseName, users[0].id]
    );
    const [race] = await sql.execute("INSERT INTO gare (nome,giorno,orario) VALUES (?,'2027-01-01','10:00')", [raceName]);
    await sql.execute('INSERT INTO enrollments_corsi (user_id,corso_id) VALUES (?,?)', [users[1].id, course.insertId]);
    await sql.execute('INSERT INTO enrollments_gare (user_id,gara_id) VALUES (?,?),(?,?)',
        [users[0].id, race.insertId, users[1].id, race.insertId]);
    await sql.execute("INSERT INTO messages (user_id,room,contenuto) VALUES (?,'general',?)", [users[0].id, preview]);
    for (const cookie of [coach, member, admin, outsider]) {
        const response = await fetch(base + '/api/chat/stanze', { headers: { Cookie: cookie } });
        assert.equal(response.status, 200, await response.clone().text());
        const rooms = await response.json();
        assert.equal(rooms.find(item => item.room_id === 'general').last_message_preview, preview);
        assert.equal(rooms.some(item => item.nome === courseName), cookie !== outsider);
        assert.equal(rooms.some(item => item.nome === raceName), cookie !== outsider);
    }
    assert.equal((await fetch(base + '/api/admin/utenti', { headers: { Cookie: member } })).status, 403);
    assert.equal((await fetch(base + '/api/coach/corsi', { headers: { Cookie: coach } })).status, 200);
    const privateChat = await fetch(base + '/api/chat/private/' + users[0].id, {
        method: 'POST', headers: { Cookie: member }
    });
    assert.equal(privateChat.status, 200, await privateChat.clone().text());
    assert.deepEqual(await privateChat.json(), { room });
    const rooms = await fetch(base + '/api/chat/stanze', { headers: { Cookie: member } });
    assert.equal(rooms.status, 200);
    assert.ok((await rooms.json()).some(stanza => stanza.room_id === room));
    const photoForm = new FormData();
    photoForm.append('immagine', new Blob([png], { type: 'image/png' }), 'profile.png');
    const photo = await fetch(base + '/api/profilo/propic', {
        method: 'POST', headers: { Cookie: member }, body: photoForm
    });
    assert.equal(photo.status, 200, await photo.clone().text());
    const { propic } = await photo.json();

    const form = new FormData();
    form.append('file_chat', new Blob([png], { type: 'image/png' }), 'qa.png');
    const upload = await fetch(base + '/api/chat/upload?room=' + room, {
        method: 'POST', headers: { Cookie: coach }, body: form
    });
    assert.equal(upload.status, 200, await upload.clone().text());
    const attachment = await upload.json();
    assert.equal((await fetch(base + '/uploads/' + attachment.file_url)).status, 404);
    assert.equal((await fetch(base + '/%75ploads/' + attachment.file_url)).status, 404);

    socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: coach }, reconnection: false });
    await once(socket, 'connect');
    const received = once(socket, 'receive_message');
    socket.emit('send_message', { room, ...attachment });
    const [message] = await received;
    const delivery = { room, contenuto: 'Prova con conferma', client_id: randomUUID() };
    const firstAck = await socket.timeout(3000).emitWithAck('send_message', delivery);
    assert.equal(firstAck.ok, true);
    socket.close();
    const url = '/api/chat/allegati/' + message.id;
    assert.equal((await fetch(base + url)).status, 401);
    assert.equal((await fetch(base + url, { headers: { Cookie: outsider } })).status, 404);
    const download = await fetch(base + url, { headers: { Cookie: member, Range: 'bytes=0-7' } });
    assert.equal(download.status, 206);
    assert.match(download.headers.get('cache-control'), /no-store/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), png.subarray(0, 8));

    const legacyName = '1731000000000_0123456789abcdef_legacy.png';
    await fs.writeFile(path.join(dir, legacyName), png);
    await sql.execute('INSERT INTO messages (user_id,room,contenuto,file_url,file_type) VALUES (?,?,?,?,?)',
        [users[0].id, room, '', legacyName, 'image/png']);
    const dryRun = await exec(process.execPath, ['scripts/migrate-media.js', '--source=' + dir], { cwd: root, env });
    assert.equal(JSON.parse(dryRun.stdout).ready, 1);
    await assert.rejects(fs.stat(path.join(env.MEDIA_DIR, legacyName)), { code: 'ENOENT' });
    const migrated = await exec(process.execPath, ['scripts/migrate-media.js', '--source=' + dir, '--apply'], { cwd: root, env });
    assert.equal(JSON.parse(migrated.stdout).copied, 1);
    assert.deepEqual(await fs.readFile(path.join(env.MEDIA_DIR, legacyName)), png);

    await stopServer(server);
    server = launchServer(env);
    base = await server.ready;
    const afterRestart = await fetch(base + url, { headers: { Cookie: member } });
    assert.equal(afterRestart.status, 200);
    assert.deepEqual(Buffer.from(await afterRestart.arrayBuffer()), png);
    const photoAfterRestart = await fetch(base + '/uploads/' + encodeURIComponent(propic));
    assert.equal(photoAfterRestart.status, 200);
    assert.deepEqual(Buffer.from(await photoAfterRestart.arrayBuffer()), png);

    socket = io(base, { transports: ['websocket'], extraHeaders: { Cookie: coach }, reconnection: false });
    await once(socket, 'connect');
    const repeatedAck = await socket.timeout(3000).emitWithAck('send_message', delivery);
    assert.deepEqual(repeatedAck, firstAck);
    const [[count]] = await sql.execute('SELECT COUNT(*) AS n FROM messages WHERE client_id = ?', [delivery.client_id]);
    assert.equal(count.n, 1);

    await sql.query('INSERT INTO messages (user_id,room,contenuto,data_invio) VALUES ?', [
        Array.from({ length: 55 }, (_, index) => [users[0].id, room, 'Storico ' + index, new Date('2025-02-01T12:00:00Z')])
    ]);
    const firstPage = once(socket, 'room_history');
    socket.emit('join_room', room);
    const [messages, metadata] = await firstPage;
    assert.equal(messages.length, 50);
    assert.deepEqual(metadata, { room, hasMore: true });
    const older = await socket.timeout(3000).emitWithAck('load_room_history', { room, beforeId: messages[0].id });
    assert.equal(older.hasMore, false);
    assert.equal(older.messages.length, 8);
    assert.equal(new Set([...older.messages, ...messages].map(message => message.id)).size, 58);

    const disconnected = once(socket, 'disconnect');
    const demoted = await fetch(base + '/api/admin/utenti/' + users[0].id, {
        method: 'PUT',
        headers: { Cookie: admin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'Coach', cognome: 'Test', eta: 25, ruolo: 'PARTNER', bio: '', certificato_scadenza: '' })
    });
    assert.equal(demoted.status, 200, await demoted.clone().text());
    await disconnected;
    assert.equal((await fetch(base + '/api/coach/corsi', { headers: { Cookie: coach } })).status, 403);
    assert.equal((await fetch(base + '/api/profilo', { headers: { Cookie: coach } })).status, 401);
    assert.equal((await fetch(base + url, { headers: { Cookie: member } })).status, 404);
});
