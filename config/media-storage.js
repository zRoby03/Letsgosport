const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

const legacyDir = path.resolve(__dirname, '..', 'public', 'uploads');
const localDir = path.resolve(process.env.MEDIA_DIR || path.join(__dirname, '..', '.data', 'uploads'));
const bucket = process.env.MEDIA_S3_BUCKET?.trim();
const s3 = bucket ? new S3Client({
    region: process.env.AWS_REGION || 'auto',
    endpoint: process.env.MEDIA_S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.MEDIA_S3_ENDPOINT),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED'
}) : null;

function safeMediaPath(dir, filename) {
    if (typeof filename !== 'string' || filename.length > 255 || !/^[\w.-]+$/.test(filename)) return null;
    const resolved = path.resolve(dir, filename);
    return path.dirname(resolved) === dir ? resolved : null;
}

function objectKey(filename) {
    return 'uploads/' + filename;
}

function mediaWritable() {
    return Boolean(s3 || process.env.MEDIA_DIR || process.env.NODE_ENV !== 'production');
}

async function storeMedia(file) {
    const destination = safeMediaPath(localDir, file.filename);
    if (!destination || !mediaWritable()) throw new Error('Storage upload non configurato.');
    if (s3) {
        await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey(file.filename),
            Body: createReadStream(file.path),
            ContentLength: file.size,
            ContentType: file.mimetype,
            IfNoneMatch: '*'
        }));
    } else {
        await fs.mkdir(localDir, { recursive: true });
        await fs.copyFile(file.path, destination, fs.constants.COPYFILE_EXCL);
    }
}

async function findLocalFile(dir, filename) {
    const filePath = safeMediaPath(dir, filename);
    if (!filePath) return null;
    try {
        return (await fs.lstat(filePath)).isFile() ? filePath : null;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function mediaExists(filename) {
    if (!safeMediaPath(localDir, filename)) return false;
    if (s3) {
        try {
            await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey(filename) }));
            return true;
        } catch (error) {
            if (error.$metadata?.httpStatusCode === 404) return false;
            throw error;
        }
    }
    return Boolean(await findLocalFile(localDir, filename));
}

async function sendMedia(req, res, filename, mimetype) {
    if (!safeMediaPath(localDir, filename)) return res.sendStatus(404);
    res.type(mimetype);

    if (s3) {
        const headOnly = req.method === 'HEAD';
        const range = req.get('range');
        const command = headOnly
            ? new HeadObjectCommand({ Bucket: bucket, Key: objectKey(filename) })
            : new GetObjectCommand({
                Bucket: bucket,
                Key: objectKey(filename),
                Range: /^bytes=(?:\d+-\d*|-\d+)$/.test(range || '') ? range : undefined
            });
        const object = await s3.send(command).catch(error => {
            if (error.$metadata?.httpStatusCode === 404) return null;
            throw error;
        });
        if (object) {
            if (object.ContentLength !== undefined) res.set('Content-Length', String(object.ContentLength));
            res.set('Accept-Ranges', 'bytes');
            if (object.ContentRange) res.status(206).set('Content-Range', object.ContentRange);
            if (headOnly) return res.end();
            return pipeline(object.Body, res);
        }
    }

    const filePath = await findLocalFile(localDir, filename) || await findLocalFile(legacyDir, filename);
    if (!filePath) return res.sendStatus(404);
    await new Promise((resolve, reject) => {
        res.sendFile(filePath, { cacheControl: false }, error => error ? reject(error) : resolve());
    });
}

async function removeMedia(filename) {
    const localPath = safeMediaPath(localDir, filename);
    const legacyPath = safeMediaPath(legacyDir, filename);
    if (!localPath || !legacyPath) return;
    const unlink = filePath => fs.unlink(filePath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
    });
    const operations = [...new Set([localPath, legacyPath])].map(unlink);
    if (s3) operations.push(s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey(filename) })));
    await Promise.all(operations);
}

module.exports = { legacyDir, mediaExists, mediaWritable, removeMedia, safeMediaPath, sendMedia, storeMedia };
