const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getStorageLimitBytes } = require('../config/media-quota');

test('il limite spazio resta attivo senza variabile e rifiuta valori non validi', t => {
    const previous = process.env.MEDIA_STORAGE_LIMIT_BYTES;
    t.after(() => {
        if (previous === undefined) delete process.env.MEDIA_STORAGE_LIMIT_BYTES;
        else process.env.MEDIA_STORAGE_LIMIT_BYTES = previous;
    });
    delete process.env.MEDIA_STORAGE_LIMIT_BYTES;
    assert.equal(getStorageLimitBytes(), 8000000000);
    process.env.MEDIA_STORAGE_LIMIT_BYTES = '';
    assert.equal(getStorageLimitBytes(), 8000000000);
    process.env.MEDIA_STORAGE_LIMIT_BYTES = '1000000000';
    assert.equal(getStorageLimitBytes(), 1000000000);
    for (const invalid of ['0', '-1', 'NaN', '8 GB']) {
        process.env.MEDIA_STORAGE_LIMIT_BYTES = invalid;
        assert.throws(getStorageLimitBytes, { code: 'MEDIA_INVALID_STORAGE_LIMIT' });
    }
});
