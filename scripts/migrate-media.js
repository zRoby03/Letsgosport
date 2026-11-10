require('dotenv').config({ quiet: true });
const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../config/db').promise();
const { legacyDir, mediaExists, safeMediaPath, storeMedia } = require('../config/media-storage');
const { fileSignatureMatches, mediaTypeForName } = require('../config/upload');

async function migrate() {
    const flags = process.argv.slice(2);
    const apply = flags.includes('--apply');
    const source = flags.find(flag => flag.startsWith('--source='));
    if (flags.some(flag => flag !== '--apply' && flag !== source)) throw new Error('Argomenti non validi.');
    const sourceDir = source ? path.resolve(source.slice('--source='.length)) : legacyDir;
    const [rows] = await db.query(
        'SELECT propic AS filename FROM users UNION SELECT propic FROM corsi UNION SELECT propic FROM gare UNION SELECT file_url FROM messages'
    );
    const bundled = new Set(['default_user.png', 'default_corso.png', 'default_gara.png', 'boxe.jpg', 'giocoleria.jpg']);
    const report = { mode: apply ? 'apply' : 'dry-run', alreadyPresent: 0, ready: 0, copied: 0, missing: [], invalid: [] };
    for (const { filename } of rows) {
        if (!filename || bundled.has(filename)) continue;
        const filePath = safeMediaPath(sourceDir, filename);
        const mimetype = mediaTypeForName(filename);
        if (!filePath || !mimetype) {
            report.invalid.push(filename);
            continue;
        }
        if (await mediaExists(filename)) {
            report.alreadyPresent++;
            continue;
        }
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
        const file = await fs.open(filePath, 'r');
        const signature = Buffer.alloc(32);
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

migrate().catch(error => {
    console.error('Migrazione upload interrotta:', error.code || error.name);
    process.exitCode = 1;
}).finally(() => db.end());
