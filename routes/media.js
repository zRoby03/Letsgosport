const express = require('express');
const db = require('../config/db');
const { sendMedia } = require('../config/media-storage');
const { mediaTypeForName } = require('../config/upload');
const { utentePuoAccedereAStanza } = require('../utils/chat-access');
const { parsePositiveSafeId } = require('../utils/socket-security');

const router = express.Router();

function query(sql, params) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
    });
}

router.get('/api/chat/allegati/:id', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const userId = parsePositiveSafeId(req.session.utenteLoggato?.id);
    if (!userId) return res.sendStatus(401);
    const messageId = parsePositiveSafeId(req.params.id);
    if (!messageId) return res.sendStatus(404);

    const [attachment] = await query(
        'SELECT m.room, m.file_url, u.id, u.ruolo FROM messages m JOIN users u ON u.id = ? WHERE m.id = ?',
        [userId, messageId]
    );
    if (!attachment?.file_url || !await utentePuoAccedereAStanza(attachment, attachment.room)) {
        return res.sendStatus(404);
    }
    const mimetype = mediaTypeForName(attachment.file_url);
    if (!mimetype) return res.sendStatus(404);
    if (mimetype === 'application/pdf') res.attachment(attachment.file_url);
    return sendMedia(req, res, attachment.file_url, mimetype);
});

router.get('/uploads/:filename', async (req, res) => {
    const { filename } = req.params;
    const mimetype = mediaTypeForName(filename);
    if (!mimetype?.startsWith('image/')) return res.sendStatus(404);

    const [row] = await query(
        'SELECT (EXISTS(SELECT 1 FROM users WHERE propic = ?) OR EXISTS(SELECT 1 FROM corsi WHERE propic = ?) OR EXISTS(SELECT 1 FROM gare WHERE propic = ?)) AND NOT EXISTS(SELECT 1 FROM messages WHERE file_url = ?) AS visible',
        [filename, filename, filename, filename]
    );
    if (!row?.visible) return res.sendStatus(404);
    return sendMedia(req, res, filename, mimetype);
});

module.exports = router;
