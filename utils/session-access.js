const db = require('../config/db');
const { parsePositiveSafeId } = require('./socket-security');

async function hasCurrentRole(user) {
    const id = parsePositiveSafeId(user?.id);
    if (!id || !['ADMIN', 'COACH', 'PARTNER'].includes(user.ruolo)) return false;
    const [rows] = await db.promise().execute('SELECT ruolo FROM users WHERE id = ?', [id]);
    return rows[0]?.ruolo === user.ruolo;
}

async function deleteUserSessions(connection, userId) {
    await connection.execute(
        "DELETE FROM sessions WHERE JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(data), data, '{}'), '$.utenteLoggato.id')) = ?",
        [String(userId)]
    );
}

module.exports = { deleteUserSessions, hasCurrentRole };
