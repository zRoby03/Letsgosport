const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const IMAGE_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
]);

const CHAT_TYPES = new Set([
    ...IMAGE_TYPES,
    'application/pdf',
    'audio/webm',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/mp4',
    'audio/aac',
    'audio/m4a',
    'audio/x-m4a'
]);

const EXT_BY_MIME = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
    'audio/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/mp4': '.mp4',
    'audio/aac': '.aac',
    'audio/m4a': '.m4a',
    'audio/x-m4a': '.m4a'
};

const EXTENSIONS_BY_MIME = {
    'image/jpeg': new Set(['.jpg', '.jpeg']),
    'image/png': new Set(['.png']),
    'image/webp': new Set(['.webp']),
    'image/gif': new Set(['.gif']),
    'application/pdf': new Set(['.pdf']),
    'audio/webm': new Set(['.webm']),
    'audio/mpeg': new Set(['.mp3']),
    'audio/mp3': new Set(['.mp3']),
    'audio/wav': new Set(['.wav']),
    'audio/x-wav': new Set(['.wav']),
    'audio/ogg': new Set(['.ogg', '.oga']),
    'audio/mp4': new Set(['.mp4', '.m4a']),
    'audio/aac': new Set(['.aac']),
    'audio/m4a': new Set(['.m4a']),
    'audio/x-m4a': new Set(['.m4a'])
};

function safeBaseName(originalName) {
    const parsed = path.parse(originalName || 'file');
    const normalized = parsed.name
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 60);

    return normalized || 'file';
}

function extensionFor(file, allowedTypes) {
    const mimeExt = EXT_BY_MIME[file.mimetype];
    const originalExt = path.extname(file.originalname || '').toLowerCase();

    if (mimeExt) return mimeExt;
    if (allowedTypes.has(file.mimetype) && originalExt.length <= 10) return originalExt;
    return '';
}

function createUpload({ allowedTypes, maxSizeBytes }) {
    const storage = multer.diskStorage({
        destination(req, file, cb) {
            cb(null, uploadDir);
        },
        filename(req, file, cb) {
            const random = crypto.randomBytes(8).toString('hex');
            const ext = extensionFor(file, allowedTypes);
            const base = safeBaseName(file.originalname);
            cb(null, `${Date.now()}_${random}_${base}${ext}`);
        }
    });

    return multer({
        storage,
        limits: {
            fileSize: maxSizeBytes,
            files: 1,
            fields: 20,
            fieldSize: 20 * 1024,
            parts: 25
        },
        fileFilter(req, file, cb) {
            file.mimetype = String(file.mimetype || '').split(';', 1)[0].toLowerCase();
            if (!allowedTypes.has(file.mimetype)) {
                const err = new Error('Tipo di file non consentito.');
                err.code = 'LIMIT_FILE_TYPE';
                return cb(err);
            }

            const originalExt = path.extname(file.originalname || '').toLowerCase();
            const allowedExtensions = EXTENSIONS_BY_MIME[file.mimetype];
            if (!allowedExtensions || !allowedExtensions.has(originalExt)) {
                const err = new Error('Estensione del file non coerente con il tipo dichiarato.');
                err.code = 'LIMIT_FILE_TYPE';
                return cb(err);
            }

            cb(null, true);
        }
    });
}

function hasBytes(buffer, bytes, offset = 0) {
    return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function fileSignatureMatches(buffer, mimetype) {
    if (mimetype === 'image/jpeg') return hasBytes(buffer, [0xff, 0xd8, 0xff]);
    if (mimetype === 'image/png') return hasBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (mimetype === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
    if (mimetype === 'image/webp') {
        return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    if (mimetype === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    if (mimetype === 'audio/webm') return hasBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
    if (mimetype === 'audio/ogg') return buffer.subarray(0, 4).toString('ascii') === 'OggS';
    if (mimetype === 'audio/wav' || mimetype === 'audio/x-wav') {
        return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WAVE';
    }
    if (mimetype === 'audio/mp4' || mimetype === 'audio/m4a' || mimetype === 'audio/x-m4a') {
        return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
    }
    if (mimetype === 'audio/aac') {
        return buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
    }
    if (mimetype === 'audio/mpeg' || mimetype === 'audio/mp3') {
        return buffer.subarray(0, 3).toString('ascii') === 'ID3'
            || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
    }
    return false;
}

async function validateStoredFile(file) {
    const handle = await fs.promises.open(file.path, 'r');
    try {
        const buffer = Buffer.alloc(32);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return bytesRead > 0 && fileSignatureMatches(buffer.subarray(0, bytesRead), file.mimetype);
    } finally {
        await handle.close();
    }
}

function singleUpload(middleware, fieldName) {
    const uploadSingle = middleware.single(fieldName);

    return (req, res, next) => {
        uploadSingle(req, res, async (err) => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ errore: 'File troppo grande.' });
                }

                if (err.code === 'LIMIT_FILE_TYPE') {
                    return res.status(400).json({ errore: err.message });
                }

                return res.status(400).json({ errore: 'Upload non valido.' });
            }

            if (!req.file) return next();

            try {
                const validSignature = await validateStoredFile(req.file);
                if (!validSignature) {
                    await fs.promises.unlink(req.file.path).catch(() => {});
                    req.file = undefined;
                    return res.status(400).json({ errore: 'Contenuto del file non valido.' });
                }
                return next();
            } catch (validationError) {
                await fs.promises.unlink(req.file.path).catch(() => {});
                req.file = undefined;
                console.error('Errore validazione upload:', validationError.code || validationError.message);
                return res.status(400).json({ errore: 'Impossibile verificare il file caricato.' });
            }
        });
    };
}

module.exports = {
    uploadProfilo: singleUpload(createUpload({
        allowedTypes: IMAGE_TYPES,
        maxSizeBytes: 2 * 1024 * 1024
    }), 'immagine'),

    uploadCopertina: singleUpload(createUpload({
        allowedTypes: IMAGE_TYPES,
        maxSizeBytes: 5 * 1024 * 1024
    }), 'propic'),

    uploadChat: singleUpload(createUpload({
        allowedTypes: CHAT_TYPES,
        maxSizeBytes: 10 * 1024 * 1024
    }), 'file_chat')
};
