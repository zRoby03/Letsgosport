const db = require('../config/db');
const { getPrivateRoomPeer, normalizeChatRoom, parsePositiveSafeId } = require('./socket-security');

function queryAsync(sql, params) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

async function utentePuoAccedereAStanza(utente, room) {
    const userId = parsePositiveSafeId(utente?.id);
    const ruolo = String(utente?.ruolo || '').toUpperCase();
    const stanza = normalizeChatRoom(room);
    if (!userId || !stanza) return false;
    if (stanza.type === 'general') return true;

    if (stanza.type === 'private') {
        if (!stanza.userIds.includes(userId)) return false;

        const altroId = getPrivateRoomPeer(stanza.room, userId);
        if (!altroId) return false;

        const results = await queryAsync(`
            SELECT id, ruolo
            FROM users
            WHERE id = ?
            LIMIT 1
        `, [altroId]);

        if (results.length === 0) return false;
        if (ruolo === 'ADMIN' || ruolo === 'COACH') return true;
        return ['ADMIN', 'COACH'].includes(String(results[0].ruolo || '').toUpperCase());
    }

    if (stanza.type === 'corso') {
        if (ruolo === 'ADMIN') {
            const results = await queryAsync(
                'SELECT id FROM corsi WHERE id = ? LIMIT 1',
                [stanza.id]
            );
            return results.length > 0;
        }

        const results = await queryAsync(`
            SELECT c.id
            FROM corsi c
            LEFT JOIN enrollments_corsi ec ON ec.corso_id = c.id AND ec.user_id = ?
            WHERE c.id = ? AND (c.coach_id = ? OR ec.user_id IS NOT NULL)
            LIMIT 1
        `, [userId, stanza.id, userId]);

        return results.length > 0;
    }

    if (stanza.type === 'gara') {
        if (ruolo === 'ADMIN') {
            const results = await queryAsync(
                'SELECT id FROM gare WHERE id = ? LIMIT 1',
                [stanza.id]
            );
            return results.length > 0;
        }

        const results = await queryAsync(`
            SELECT gara_id
            FROM enrollments_gare
            WHERE gara_id = ? AND user_id = ?
            LIMIT 1
        `, [stanza.id, userId]);

        return results.length > 0;
    }

    return false;
}

async function salvaChatPrivata(stanza) {
    await queryAsync(
        'INSERT INTO private_conversations (first_user_id, second_user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE first_user_id = first_user_id',
        [...stanza.userIds].sort((first, second) => first - second)
    );
}

module.exports = { salvaChatPrivata, utentePuoAccedereAStanza };
