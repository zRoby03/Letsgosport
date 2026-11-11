const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { test } = require('node:test');
const axios = require('axios');
const { getIceServers } = require('../config/turn');

const names = ['TURN_ENABLED', 'TURN_KEY_ID', 'TURN_KEY_API_TOKEN', 'TURN_URLS',
    'TURN_SHARED_SECRET', 'TURN_ALLOWED_EMAILS', 'TURN_TTL_SECONDS'];
const user = { id: 12, email: 'tester@example.test' };
const keyId = '0123456789abcdef0123456789abcdef';
const temporary = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp',
    'turns:turn.cloudflare.com:443?transport=tcp'], username: 'temporary-user', credential: 'temporary-password' }];

function configure(t, values = {}) {
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    Object.assign(process.env, values);
    t.after(() => {
        for (const name of names) {
            if (previous[name] === undefined) delete process.env[name];
            else process.env[name] = previous[name];
        }
    });
}

test('senza TURN configurato rimane disponibile la connessione diretta', async t => {
    configure(t);
    assert.deepEqual(await getIceServers(user), []);
});

test('Cloudflare restituisce solo credenziali temporanee e usa un timeout limitato', async t => {
    configure(t, { TURN_KEY_ID: keyId, TURN_KEY_API_TOKEN: 'private-api-token', TURN_TTL_SECONDS: '3600' });
    t.mock.method(axios, 'post', async (url, body, options) => {
        assert.equal(url, 'https://rtc.live.cloudflare.com/v1/turn/keys/' + keyId + '/credentials/generate-ice-servers');
        assert.deepEqual(body, { ttl: 3600 });
        assert.equal(options.headers.Authorization, 'Bearer private-api-token');
        assert.equal(options.timeout, 3500);
        assert.equal(options.maxRedirects, 0);
        return { data: { iceServers: [{ ...temporary[0], privateToken: 'private-api-token' }] } };
    });
    const result = await getIceServers(user);
    assert.deepEqual(result, temporary);
    assert.ok(!JSON.stringify(result).includes('private-api-token'));
});

test('la lista degli account ammessi e lo spegnimento impediscono nuove credenziali', async t => {
    configure(t, { TURN_KEY_ID: keyId, TURN_KEY_API_TOKEN: 'private-api-token', TURN_ALLOWED_EMAILS: 'other@example.test' });
    const post = t.mock.method(axios, 'post', async () => ({ data: { iceServers: temporary } }));
    await assert.rejects(getIceServers(user), { code: 'TURN_USER_NOT_ALLOWED', status: 403 });
    assert.equal(post.mock.callCount(), 0);
    process.env.TURN_ALLOWED_EMAILS = ' TESTER@EXAMPLE.TEST ';
    assert.deepEqual(await getIceServers(user), temporary);
    process.env.TURN_ENABLED = 'false';
    assert.deepEqual(await getIceServers(user), []);
    assert.equal(post.mock.callCount(), 1);
});

test('errori e risposte non valide del provider non espongono il token', async t => {
    configure(t, { TURN_KEY_ID: keyId, TURN_KEY_API_TOKEN: 'private-api-token' });
    const post = t.mock.method(axios, 'post', async () => {
        throw new Error('Authorization: Bearer private-api-token');
    });
    await assert.rejects(getIceServers(user), error => error.code === 'TURN_PROVIDER_UNAVAILABLE' &&
        !String(error).includes('private-api-token') && !error.cause);
    post.mock.mockImplementation(async () => ({ data: { iceServers: [{ urls: ['https://invalid.example'] }] } }));
    await assert.rejects(getIceServers(user), { code: 'TURN_INVALID_RESPONSE' });
    post.mock.mockImplementation(async () => ({ data: { iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'] }] } }));
    await assert.rejects(getIceServers(user), { code: 'TURN_INVALID_RESPONSE' });
    process.env.TURN_KEY_ID = '../invalid-key';
    await assert.rejects(getIceServers(user), { code: 'TURN_INVALID_CONFIGURATION' });
});

test('coturn continua a usare la firma HMAC con scadenza', async t => {
    configure(t, { TURN_URLS: ' turn:relay.example:3478?transport=udp, turns:relay.example:443?transport=tcp ',
        TURN_SHARED_SECRET: 'coturn-private-secret', TURN_TTL_SECONDS: '1800' });
    t.mock.method(Date, 'now', () => 1800000000000);
    const username = '1800001800:12';
    assert.deepEqual(await getIceServers(user), [{
        urls: ['turn:relay.example:3478?transport=udp', 'turns:relay.example:443?transport=tcp'],
        username, credential: createHmac('sha1', 'coturn-private-secret').update(username).digest('base64')
    }]);
    process.env.TURN_TTL_SECONDS = '0';
    await assert.rejects(getIceServers(user), { code: 'TURN_INVALID_TTL' });
});
