const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');

const sqlPort = Number(process.env.LGS_TEST_MYSQL_PORT);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZd0AAAAASUVORK5CYII=', 'base64');

test('quota R2: paginazione, upload simultanei, riavvio ed esiti incerti', { skip: !sqlPort, timeout: 45000 }, async t => {
    const database = 'letsgosport_quota_' + randomBytes(6).toString('hex');
    const objects = new Map([['other/a', Buffer.alloc(7)], ['other/b', Buffer.alloc(6)]]);
    let listDenied = false;
    let uncertainWrite = false;
    let writeDenied = false;
    let lastWrite;
    let putCount = 0;
    const storage = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.searchParams.get('list-type') === '2') {
            if (listDenied) {
                res.writeHead(403, { 'Content-Type': 'application/xml' });
                return res.end('<Error><Code>AccessDenied</Code></Error>');
            }
            const keys = [...objects.keys()].sort();
            const offset = Number(url.searchParams.get('continuation-token') || 0);
            const key = keys[offset];
            const more = offset + 1 < keys.length;
            res.setHeader('Content-Type', 'application/xml');
            return res.end('<ListBucketResult><Name>test-media</Name><IsTruncated>' + more + '</IsTruncated>' +
                (more ? '<NextContinuationToken>' + (offset + 1) + '</NextContinuationToken>' : '') +
                (key ? '<Contents><Key>' + key + '</Key><Size>' + objects.get(key).length + '</Size></Contents>' : '') +
                '</ListBucketResult>');
        }
        if (req.method === 'PUT') {
            putCount++;
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            lastWrite = { key: url.pathname.replace('/test-media/', ''), bytes: Buffer.concat(chunks) };
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
    let sql;
    let child;
    let base;
    const env = {
        ...process.env, NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: String(sqlPort),
        DB_USER: process.env.LGS_TEST_MYSQL_USER || 'root', DB_PASSWORD: process.env.LGS_TEST_MYSQL_PASSWORD || '',
        DB_NAME: database, DB_SSL: 'false',
        MEDIA_S3_BUCKET: 'test-media', AWS_REGION: 'auto', AWS_ACCESS_KEY_ID: 'test-key', AWS_SECRET_ACCESS_KEY: 'test-secret',
        MEDIA_STORAGE_LIMIT_BYTES: String(13 + png.length)
    };
    async function stop() {
        if (!child || child.exitCode !== null || child.signalCode) return;
        const exited = once(child, 'exit');
        child.kill();
        await exited;
    }
    async function launch() {
        const script = `
            const express = require('express');
            const { uploadProfilo } = require('./config/upload');
            const app = express();
            app.get('/health', (req, res) => res.sendStatus(200));
            app.post('/upload', uploadProfilo, (req, res) => res.json({ filename: req.file.filename }));
            const server = app.listen(0, '127.0.0.1', () => console.log('READY ' + server.address().port));
        `;
        child = spawn(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), env, windowsHide: true });
        base = await new Promise((resolve, reject) => {
            let output = '';
            const timer = setTimeout(() => reject(new Error('Timeout avvio server quota')), 10000);
            child.stdout.on('data', chunk => {
                output += chunk;
                const port = /READY (\d+)/.exec(output)?.[1];
                if (port) { clearTimeout(timer); resolve('http://127.0.0.1:' + port); }
            });
            child.stderr.on('data', chunk => { output += chunk; });
            child.once('exit', code => { clearTimeout(timer); reject(new Error('Server quota terminato: ' + code + ' ' + output)); });
        });
    }
    async function upload() {
        const form = new FormData();
        form.append('immagine', new Blob([png], { type: 'image/png' }), 'profile.png');
        const response = await fetch(base + '/upload', { method: 'POST', body: form });
        return { status: response.status, data: await response.json() };
    }
    t.after(async () => {
        await stop();
        storage.closeAllConnections();
        await new Promise(resolve => storage.close(resolve));
        if (sql) { await sql.query('DROP DATABASE IF EXISTS ' + database); await sql.end(); }
    });
    await once(storage, 'listening');
    env.MEDIA_S3_ENDPOINT = 'http://127.0.0.1:' + storage.address().port;
    sql = await mysql.createConnection({ host: env.DB_HOST, port: sqlPort, user: env.DB_USER, password: env.DB_PASSWORD });
    await sql.query('CREATE DATABASE ' + database);
    await launch();
    const results = await Promise.all([upload(), upload()]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.match(results.find(result => result.status === 409).data.errore, /Spazio disponibile/);
    assert.equal(putCount, 1);
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
    const failedWriteCount = putCount;
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
    assert.equal([...objects.values()].reduce((total, bytes) => total + bytes.length, 0), 13 + 2 * png.length);
});
