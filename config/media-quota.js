const { createHash } = require('node:crypto');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

let schemaReady;

function quotaError(code) {
    return Object.assign(new Error('Quota archiviazione non disponibile.'), { code });
}

function getStorageLimitBytes() {
    const configured = process.env.MEDIA_STORAGE_LIMIT_BYTES;
    const limit = configured === undefined || configured.trim() === '' ? 8000000000 : Number(configured);
    if (!Number.isSafeInteger(limit) || limit < 1) throw quotaError('MEDIA_INVALID_STORAGE_LIMIT');
    return limit;
}

async function reserveMediaStorage(s3, bucket, objectKey, size) {
    const limit = getStorageLimitBytes();
    if (!Number.isSafeInteger(size) || size < 0) {
        throw quotaError('MEDIA_INVALID_STORAGE_LIMIT');
    }
    if (size > limit) throw quotaError('MEDIA_STORAGE_QUOTA_EXCEEDED');

    const pool = require('./db').promise();
    if (!schemaReady) {
        schemaReady = pool.query(`CREATE TABLE IF NOT EXISTS media_upload_reservations (
            bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            object_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            size_bytes BIGINT UNSIGNED NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (bucket_key, object_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`)
            .catch(error => { schemaReady = undefined; throw error; });
    }
    await schemaReady;
    const bucketKey = createHash('sha256').update(bucket).digest('hex');
    await pool.execute('INSERT IGNORE INTO media_upload_reservations (bucket_key,object_key,size_bytes) VALUES (?,\'\',0)', [bucketKey]);
    const connection = await pool.getConnection();
    try {
        await connection.query('BEGIN /*T! PESSIMISTIC */');
        await connection.execute('SELECT size_bytes FROM media_upload_reservations WHERE bucket_key=? AND object_key=\'\' FOR UPDATE', [bucketKey]);
        const [rows] = await connection.execute('SELECT object_key,size_bytes FROM media_upload_reservations WHERE bucket_key=? AND object_key<>\'\' FOR UPDATE', [bucketKey]);
        const pending = new Map(rows.map(row => [row.object_key, Number(row.size_bytes)]));
        if ([...pending.values()].some(bytes => !Number.isSafeInteger(bytes) || bytes < 0)) {
            throw quotaError('MEDIA_INVALID_STORAGE_USAGE');
        }
        let used = 0;
        let continuation;
        const seen = new Set();
        do {
            const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuation }),
                { abortSignal: AbortSignal.timeout(10000) });
            if (page.Name !== bucket || typeof page.IsTruncated !== 'boolean') {
                throw quotaError('MEDIA_INVALID_STORAGE_USAGE');
            }
            for (const object of page.Contents || []) {
                const bytes = Number(object.Size);
                if (typeof object.Key !== 'string' || !Number.isSafeInteger(bytes) || bytes < 0) {
                    throw quotaError('MEDIA_INVALID_STORAGE_USAGE');
                }
                used += bytes;
                pending.delete(object.Key);
            }
            if (used + size > limit) throw quotaError('MEDIA_STORAGE_QUOTA_EXCEEDED');
            continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
            if (page.IsTruncated && (typeof continuation !== 'string' || !continuation || seen.has(continuation))) {
                throw quotaError('MEDIA_INVALID_STORAGE_USAGE');
            }
            if (continuation) seen.add(continuation);
        } while (continuation);
        const reserved = [...pending.values()].reduce((total, bytes) => total + bytes, 0);
        if (used + reserved + size > limit) throw quotaError('MEDIA_STORAGE_QUOTA_EXCEEDED');
        await connection.execute('INSERT INTO media_upload_reservations (bucket_key,object_key,size_bytes) VALUES (?,?,?)',
            [bucketKey, objectKey, size]);
        await connection.commit();
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }

    return async () => {
        await pool.execute('DELETE FROM media_upload_reservations WHERE bucket_key=? AND object_key=?', [bucketKey, objectKey]);
    };
}

module.exports = { getStorageLimitBytes, reserveMediaStorage };
