const crypto = require('crypto');
const { legacyDir, removeMedia, safeMediaPath } = require('../config/media-storage');

const usedUploadTokens = new Map();
const TOKEN_TTL_MS = 10 * 60 * 1000;
const GENERATED_UPLOAD_NAME = /^\d{12,}_[a-f0-9]{16}_[\w.-]+\.[a-z0-9]+$/i;

function getSigningSecret() {
    return process.env.SESSION_SECRET || 'local-development-upload-secret';
}

function safeUploadPath(filename) {
    return safeMediaPath(legacyDir, filename);
}

function uploadFilename(fileOrName) {
    return typeof fileOrName === 'string' ? fileOrName : fileOrName?.filename;
}

function isGeneratedUploadName(filename) {
    return typeof filename === 'string'
        && GENERATED_UPLOAD_NAME.test(filename)
        && Boolean(safeUploadPath(filename));
}

async function removeUploadedFile(fileOrName) {
    const filename = uploadFilename(fileOrName);
    if (!isGeneratedUploadName(filename)) return false;
    try {
        await removeMedia(filename);
        return true;
    } catch (error) {
        console.error('Errore rimozione file upload:', error.code || error.name);
        return false;
    }
}

function queryAsync(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, results) => {
            if (error) reject(error);
            else resolve(results);
        });
    });
}

async function uploadIsReferenced(filename, db) {
    const checks = await Promise.all([
        queryAsync(db, 'SELECT id FROM users WHERE propic = ? LIMIT 1', [filename]),
        queryAsync(db, 'SELECT id FROM corsi WHERE propic = ? LIMIT 1', [filename]),
        queryAsync(db, 'SELECT id FROM gare WHERE propic = ? LIMIT 1', [filename]),
        queryAsync(db, 'SELECT id FROM messages WHERE file_url = ? LIMIT 1', [filename])
    ]);

    return checks.some(results => results.length > 0);
}

async function removeUploadedFileIfUnused(fileOrName, db) {
    const filename = uploadFilename(fileOrName);
    if (!isGeneratedUploadName(filename) || !db) return false;

    try {
        if (await uploadIsReferenced(filename, db)) return false;
        return await removeUploadedFile(filename);
    } catch (error) {
        console.error('Errore controllo riferimenti upload:', error.code || error.message);
        return false;
    }
}

function encodePayload(payload) {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function signPayload(encodedPayload) {
    return crypto
        .createHmac('sha256', getSigningSecret())
        .update(encodedPayload)
        .digest('base64url');
}

function cleanTokenRoom(room) {
    return typeof room === 'string' && room.length > 0 && room.length <= 50 ? room : null;
}

function createChatUploadToken({ filename, mimetype, userId, room }) {
    const tokenRoom = cleanTokenRoom(room);
    if (!tokenRoom) throw new Error('Stanza upload non valida.');

    const payload = encodePayload({
        filename,
        mimetype,
        userId: Number(userId),
        room: tokenRoom,
        expiresAt: Date.now() + TOKEN_TTL_MS,
        nonce: crypto.randomBytes(12).toString('hex')
    });

    return `${payload}.${signPayload(payload)}`;
}

function pruneUsedTokens() {
    const now = Date.now();
    for (const [tokenHash, expiresAt] of usedUploadTokens) {
        if (expiresAt <= now) usedUploadTokens.delete(tokenHash);
    }
}

function consumeChatUploadToken(token, { filename, mimetype, userId, room }) {
    const tokenRoom = cleanTokenRoom(room);
    if (!tokenRoom) return false;

    if (typeof token !== 'string' || token.length > 1500) return false;
    const [payloadPart, signaturePart, extra] = token.split('.');
    if (!payloadPart || !signaturePart || extra) return false;

    const expectedSignature = signPayload(payloadPart);
    const actual = Buffer.from(signaturePart);
    const expected = Buffer.from(expectedSignature);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;

    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    } catch {
        return false;
    }

    if (
        payload.expiresAt <= Date.now() ||
        payload.filename !== filename ||
        payload.mimetype !== mimetype ||
        Number(payload.userId) !== Number(userId) ||
        payload.room !== tokenRoom ||
        !safeUploadPath(payload.filename)
    ) {
        return false;
    }

    pruneUsedTokens();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    if (usedUploadTokens.has(tokenHash)) return false;
    usedUploadTokens.set(tokenHash, payload.expiresAt);
    return true;
}

module.exports = {
    CHAT_UPLOAD_TOKEN_TTL_MS: TOKEN_TTL_MS,
    createChatUploadToken,
    consumeChatUploadToken,
    isGeneratedUploadName,
    removeUploadedFile,
    removeUploadedFileIfUnused,
    safeUploadPath
};
