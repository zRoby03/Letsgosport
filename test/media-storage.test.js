const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');

const exec = promisify(execFile);
const root = path.resolve(__dirname, '..');

test('un endpoint S3 non valido restituisce 503 senza interrompere il server', async () => {
    const script = `
        const assert = require('node:assert/strict');
        const { once } = require('node:events');
        const fs = require('node:fs');
        const open = fs.open;
        fs.open = (...args) => setTimeout(() => open(...args), 50);
        const express = require('express');
        const { uploadProfilo } = require('./config/upload');
        const app = express();
        app.post('/upload', uploadProfilo, (req, res) => res.sendStatus(200));
        app.get('/health', (req, res) => res.sendStatus(200));
        const server = app.listen(0, '127.0.0.1');
        (async () => {
            await once(server, 'listening');
            const base = 'http://127.0.0.1:' + server.address().port;
            try {
                const form = new FormData();
                const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZd0AAAAASUVORK5CYII=', 'base64');
                form.append('immagine', new Blob([png], { type: 'image/png' }), 'profile.png');
                const upload = await fetch(base + '/upload', { method: 'POST', body: form });
                assert.equal(upload.status, 503);
                assert.match((await upload.json()).errore, /salvare il file/);
                const health = await fetch(base + '/health');
                assert.equal(health.status, 200);
                await health.text();
            } finally {
                server.closeAllConnections();
                await new Promise(resolve => server.close(resolve));
            }
        })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = await exec(process.execPath, ['-e', script], {
        cwd: root,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            MEDIA_S3_BUCKET: 'test-media',
            MEDIA_S3_ENDPOINT: 'not-an-endpoint',
            AWS_REGION: 'auto',
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key'
        },
        timeout: 15000,
        windowsHide: true
    });
    assert.doesNotMatch(result.stderr, /Unhandled 'error' event/);
});

test('upload S3 e lettura parziale conservano il contenuto del file', async () => {
    const script = `
        const assert = require('node:assert/strict');
        const { once } = require('node:events');
        const http = require('node:http');
        const express = require('express');
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZd0AAAAASUVORK5CYII=', 'base64');
        let stored;
        const bucket = http.createServer(async (req, res) => {
            if (req.method === 'PUT') {
                const chunks = [];
                for await (const chunk of req) chunks.push(chunk);
                stored = { path: new URL(req.url, 'http://localhost').pathname, bytes: Buffer.concat(chunks), type: req.headers['content-type'], condition: req.headers['if-none-match'] };
                res.setHeader('ETag', '\"test-etag\"');
                return res.end();
            }
            const range = req.headers.range;
            const bytes = range ? stored.bytes.subarray(0, 8) : stored.bytes;
            res.setHeader('Content-Type', stored.type);
            res.setHeader('Content-Length', bytes.length);
            if (range) {
                res.statusCode = 206;
                res.setHeader('Content-Range', 'bytes 0-7/' + stored.bytes.length);
            }
            res.end(req.method === 'HEAD' ? undefined : bytes);
        }).listen(0, '127.0.0.1');
        let server;
        (async () => {
            await once(bucket, 'listening');
            process.env.MEDIA_S3_ENDPOINT = 'http://127.0.0.1:' + bucket.address().port;
            const { uploadProfilo } = require('./config/upload');
            const { sendMedia } = require('./config/media-storage');
            const app = express();
            app.post('/upload', uploadProfilo, (req, res) => res.json({ filename: req.file.filename }));
            app.get('/media/:filename', (req, res) => sendMedia(req, res, req.params.filename, 'image/png'));
            server = app.listen(0, '127.0.0.1');
            await once(server, 'listening');
            const base = 'http://127.0.0.1:' + server.address().port;
            try {
                const form = new FormData();
                form.append('immagine', new Blob([png], { type: 'image/png' }), 'profile.png');
                const upload = await fetch(base + '/upload', { method: 'POST', body: form });
                assert.equal(upload.status, 200, await upload.clone().text());
                const { filename } = await upload.json();
                assert.equal(stored.path, '/test-media/uploads/' + filename);
                assert.deepEqual(stored.bytes, png);
                assert.equal(stored.condition, '*');
                const download = await fetch(base + '/media/' + filename);
                assert.equal(download.status, 200);
                assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
                const partial = await fetch(base + '/media/' + filename, { headers: { Range: 'bytes=0-7' } });
                assert.equal(partial.status, 206);
                assert.equal(partial.headers.get('content-range'), 'bytes 0-7/' + png.length);
                assert.deepEqual(Buffer.from(await partial.arrayBuffer()), png.subarray(0, 8));
                const head = await fetch(base + '/media/' + filename, { method: 'HEAD' });
                assert.equal(head.status, 200);
                assert.equal(head.headers.get('content-length'), String(png.length));
                assert.equal((await head.arrayBuffer()).byteLength, 0);
            } finally {
                server.closeAllConnections();
                await new Promise(resolve => server.close(resolve));
                bucket.closeAllConnections();
                await new Promise(resolve => bucket.close(resolve));
            }
        })().catch(error => { console.error(error); process.exitCode = 1; bucket.close(); server?.close(); });
    `;
    await exec(process.execPath, ['-e', script], {
        cwd: root,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            MEDIA_S3_BUCKET: 'test-media',
            AWS_REGION: 'auto',
            AWS_ACCESS_KEY_ID: 'test-access-key',
            AWS_SECRET_ACCESS_KEY: 'test-secret-key'
        },
        timeout: 15000,
        windowsHide: true
    });
});
