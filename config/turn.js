const { createHmac } = require('node:crypto');
const axios = require('axios');

function turnError(code, status = 503) {
    return Object.assign(new Error('Servizio TURN non disponibile.'), { code, status });
}

async function getIceServers(user) {
    if (['false', '0'].includes(String(process.env.TURN_ENABLED || '').trim().toLowerCase())) return [];

    const keyId = String(process.env.TURN_KEY_ID || '').trim();
    const apiToken = String(process.env.TURN_KEY_API_TOKEN || '').trim();
    const urls = String(process.env.TURN_URLS || '').split(',')
        .map(url => url.trim())
        .filter(url => /^turns?:[^\s]+$/i.test(url));
    const secret = process.env.TURN_SHARED_SECRET;
    if (!keyId && !apiToken && (!urls.length || !secret)) return [];

    const allowedEmails = String(process.env.TURN_ALLOWED_EMAILS || '').split(',')
        .map(email => email.trim().toLowerCase()).filter(Boolean);
    if (allowedEmails.length && !allowedEmails.includes(String(user.email || '').trim().toLowerCase())) {
        throw turnError('TURN_USER_NOT_ALLOWED', 403);
    }

    const ttl = Number(process.env.TURN_TTL_SECONDS || 14400);
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 172800) throw turnError('TURN_INVALID_TTL');

    if (keyId || apiToken) {
        if (!/^[a-f0-9]{32}$/i.test(keyId) || !apiToken) throw turnError('TURN_INVALID_CONFIGURATION');
        let data;
        try {
            ({ data } = await axios.post(
                'https://rtc.live.cloudflare.com/v1/turn/keys/' + keyId + '/credentials/generate-ice-servers',
                { ttl },
                {
                    headers: { Authorization: 'Bearer ' + apiToken, 'Content-Type': 'application/json' },
                    timeout: 3500,
                    maxRedirects: 0
                }
            ));
        } catch {
            // Provider errors can contain authorization headers: only expose a fixed error code.
            throw turnError('TURN_PROVIDER_UNAVAILABLE');
        }
        if (!Array.isArray(data?.iceServers)) throw turnError('TURN_INVALID_RESPONSE');
        const servers = data.iceServers.flatMap(server => {
            const values = Array.isArray(server?.urls) ? server.urls : [server?.urls];
            const addresses = values.filter(url => typeof url === 'string' && /^(?:stun|stuns|turn|turns):[^\s]+$/i.test(url));
            if (!addresses.length) return [];
            if (addresses.some(url => /^turns?:/i.test(url))) {
                if (typeof server.username !== 'string' || !server.username ||
                    typeof server.credential !== 'string' || !server.credential) return [];
                return [{ urls: addresses, username: server.username, credential: server.credential }];
            }
            return [{ urls: addresses }];
        });
        if (!servers.some(server => server.urls.some(url => /^turns?:/i.test(url)))) {
            throw turnError('TURN_INVALID_RESPONSE');
        }
        return servers;
    }

    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const username = expiresAt + ':' + user.id;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    return [{ urls, username, credential }];
}

module.exports = { getIceServers };
