require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('node:path');
const http = require('http'); 
const { Server } = require('socket.io'); 
const db = require('./config/db');
const { getStorageLimitBytes } = require('./config/media-quota');
const {
    consumeChatUploadToken,
    isGeneratedUploadName,
    removeUploadedFileIfUnused
} = require('./utils/file-security');
const { salvaChatPrivata, utentePuoAccedereAStanza } = require('./utils/chat-access');
const { hasCurrentRole } = require('./utils/session-access');
const {
    cleanText
} = require('./utils/validation');
const {
    CallRegistry,
    createRateLimiter,
    getPrivateRoomPeer,
    isValidIceCandidate,
    isValidSdp,
    normalizeChatRoom,
    parsePositiveSafeId
} = require('./utils/socket-security');

const app = express();
const server = http.createServer(app);
const isProduction = process.env.NODE_ENV === 'production';
const socketOptions = {};
if (!isProduction) {
    socketOptions.cors = {
        origin: true,
        credentials: true
    };
} else if (process.env.PUBLIC_ORIGIN) {
    socketOptions.cors = {
        origin: process.env.PUBLIC_ORIGIN,
        credentials: true
    };
}
const io = new Server(server, socketOptions);

const PORT = process.env.PORT || 3000;

if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET deve essere configurata in produzione.');
}

// Render termina TLS sul proxy e inoltra la richiesta all'applicazione.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
        'Permissions-Policy',
        'camera=(self), microphone=(self), display-capture=(self)'
    );
    next();
});

const publicDir = path.join(__dirname, 'public');
for (const folder of ['css', 'js', 'sounds', 'uploads/buttons', 'uploads/catalog', 'uploads/defaults', 'uploads/sliders']) {
    app.use('/' + folder, express.static(path.join(publicDir, folder), { dotfiles: 'deny', index: false }));
}
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
for (const asset of ['manifest.json', 'icon.svg', 'sw.js']) {
    app.get('/' + asset, (req, res) => res.sendFile(path.join(publicDir, asset)));
}
app.use(express.json({ limit: '100kb' }));

// Le API che modificano dati accettano richieste browser solo dalla stessa origine.
// I client non-browser senza header Origin restano compatibili (script locali, health check).
app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const origin = req.get('origin');
    if (!origin) return next();

    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    if (origin === requestOrigin) return next();

    return res.status(403).json({ errore: 'Origine della richiesta non consentita.' });
});

// Le sessioni persistono nel database per supportare riavvii e più istanze.
const sessionStore = new MySQLStore({
    clearExpired: true,
    checkExpirationInterval: 900000,
    expiration: 86400000,
    createDatabaseTable: true
}, db);

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'chiave_segreta_super_sicura_fallback', 
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);
app.locals.revokeUserSockets = userId => io.in('user_' + userId).disconnectSockets(true);

app.use(require('./routes/media'));
app.use('/api', require('./routes/auth'));       
app.use('/api', require('./routes/public'));     
app.use('/api', require('./routes/user'));       
app.use('/api/admin', require('./routes/admin'));
app.use('/api/coach', require('./routes/coach'));

app.get('/api/health', async (req, res) => {
    try {
        await db.checkConnection();
        res.json({
            status: 'ok',
            database: 'connected',
            release: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'local',
            storageLimitBytes: process.env.MEDIA_S3_BUCKET?.trim() ? getStorageLimitBytes() : null
        });
    } catch (error) {
        console.error('Health check fallito:', error.code || error.name);
        res.status(503).json({ status: 'error', database: error.code === 'MEDIA_INVALID_STORAGE_LIMIT' ? 'connected' : 'unavailable' });
    }
});

const utentiOnline = {}; 
const statiPersonali = {};
const chiamateAttive = new CallRegistry();

function queryAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

async function caricaStoricoChat(room, beforeId) {
    const params = [room];
    let cursorFilter = '';
    if (beforeId) {
        const [anchor] = await queryAsync('SELECT data_invio FROM messages WHERE id = ? AND room = ?', [beforeId, room]);
        if (!anchor) return { messages: [], hasMore: false };
        cursorFilter = 'AND (m.data_invio < ? OR (m.data_invio = ? AND m.id < ?))';
        params.push(anchor.data_invio, anchor.data_invio, beforeId);
    }
    const rows = await queryAsync(
        'SELECT m.*, u.nome, u.cognome, u.propic FROM messages m JOIN users u ON m.user_id = u.id ' +
        'WHERE m.room = ? ' + cursorFilter + ' ORDER BY m.data_invio DESC, m.id DESC LIMIT 51',
        params
    );
    return { messages: rows.slice(0, 50).reverse(), hasMore: rows.length > 50 };
}

async function utentePuoModerareStanza(utente, room) {
    const userId = parsePositiveSafeId(utente?.id);
    const ruolo = String(utente?.ruolo || '').toUpperCase();
    const stanza = normalizeChatRoom(room);
    if (!userId || !stanza) return false;

    if (ruolo === 'ADMIN') return true;
    if (ruolo !== 'COACH') return false;

    if (stanza.type === 'private') {
        return stanza.userIds.includes(userId);
    }

    if (stanza.type === 'corso') {
        const results = await queryAsync(
            'SELECT id FROM corsi WHERE id = ? AND coach_id = ? LIMIT 1',
            [stanza.id, userId]
        );
        return results.length > 0;
    }

    return false;
}

async function autorizzaStanzaChat(utente, room) {
    const stanza = normalizeChatRoom(room);
    if (!stanza) return null;

    return await utentePuoAccedereAStanza(utente, stanza.room) ? stanza : null;
}

function stanzeChatSocket(socket) {
    if (!socket.data.stanzeChat) socket.data.stanzeChat = new Set();
    return socket.data.stanzeChat;
}

function entraInStanzaChat(socket, stanza) {
    socket.join(stanza.room);
    stanzeChatSocket(socket).add(stanza.room);
}

function lasciaStanzaChat(socket, room) {
    const stanza = normalizeChatRoom(room);
    if (!stanza) return;

    socket.leave(stanza.room);
    stanzeChatSocket(socket).delete(stanza.room);
}

async function rimuoviStanzeNonAutorizzate(socket, utente) {
    const stanzeCorrenti = [...stanzeChatSocket(socket)];
    for (const room of stanzeCorrenti) {
        try {
            if (!await utentePuoAccedereAStanza(utente, room)) {
                lasciaStanzaChat(socket, room);
            }
        } catch (err) {
            console.error('Errore verifica stanza Socket:', err);
            lasciaStanzaChat(socket, room);
        }
    }
}

function emettiErroreChat(socket, messaggio) {
    socket.emit('chat_error', { errore: messaggio });
}

async function richiediStanzaAutorizzata(socket, utente, room, opzioni = {}) {
    const {
        contesto = 'chat',
        messaggioPermessi,
        messaggioErrore
    } = opzioni;

    try {
        const stanza = await autorizzaStanzaChat(utente, room);
        if (!stanza) {
            lasciaStanzaChat(socket, room);
            if (messaggioPermessi) emettiErroreChat(socket, messaggioPermessi);
            return null;
        }
        return stanza;
    } catch (err) {
        console.error(`Errore autorizzazione ${contesto}:`, err);
        if (messaggioErrore) emettiErroreChat(socket, messaggioErrore);
        return null;
    }
}

async function utentePuoChiamare(utente, targetId) {
    const callerId = parsePositiveSafeId(utente?.id);
    const destinatarioId = parsePositiveSafeId(targetId);
    if (!callerId || !destinatarioId || callerId === destinatarioId) return false;

    const results = await queryAsync(
        'SELECT id, ruolo FROM users WHERE id = ? LIMIT 1',
        [destinatarioId]
    );
    if (results.length === 0) return false;
    const ruolo = String(utente?.ruolo || '').toUpperCase();
    const ruoloDestinatario = String(results[0].ruolo || '').toUpperCase();
    if (ruolo === 'ADMIN' || ruolo === 'COACH') return true;
    return ruoloDestinatario === 'ADMIN' || ruoloDestinatario === 'COACH';
}

function normalizzaUtenteSocket(utente) {
    const id = parsePositiveSafeId(utente?.id);
    const ruolo = String(utente?.ruolo || '').toUpperCase();
    if (!id || !['ADMIN', 'COACH', 'PARTNER'].includes(ruolo)) return null;

    return {
        ...utente,
        id,
        ruolo
    };
}

io.use(async (socket, next) => {
    const utente = normalizzaUtenteSocket(socket.request.session?.utenteLoggato);
    try {
        if (!utente || !await hasCurrentRole(utente)) return next(new Error('Non autorizzato'));
    } catch (error) {
        console.error('Errore verifica ruolo socket:', error.code || error.name);
        return next(new Error('Sessione non disponibile'));
    }

    socket.data.utente = utente;
    next();
});

io.on('connection', (socket) => {
    const utente = socket.data.utente;
    
    if (!utente || !utente.id) {
        return socket.disconnect(true);
    }

    const userId = utente.id;
    const allowChatEvent = createRateLimiter(90, 10 * 1000);
    const allowRoomEvent = createRateLimiter(30, 30 * 1000);
    const allowSignalingEvent = createRateLimiter(120, 10 * 1000);
    socket.join('user_' + userId);

    if (!utentiOnline[userId]) {
        utentiOnline[userId] = 0;
        socket.broadcast.emit('utente_connesso', { id: userId, stato: statiPersonali[userId] || 'ONLINE' });
    }
    utentiOnline[userId]++;

    const mappa = {};
    for (let id in utentiOnline) mappa[id] = statiPersonali[id] || 'ONLINE';
    socket.emit('utenti_online_iniziali', mappa);

    socket.on('cambia_stato', (stato) => {
        if (stato !== 'ONLINE' && stato !== 'DND') return;
        statiPersonali[userId] = stato;
        io.emit('stato_aggiornato', { id: userId, stato });
    });

    socket.on('listen_all_rooms', async (roomsArray) => {
        if (!allowRoomEvent() || !Array.isArray(roomsArray)) return;

        const rooms = [...new Set(
            roomsArray
                .map(room => normalizeChatRoom(room)?.room)
                .filter(Boolean)
        )].slice(0, 100);

        for (const room of rooms) {
            try {
                const stanza = await autorizzaStanzaChat(utente, room);
                if (stanza) entraInStanzaChat(socket, stanza);
                else lasciaStanzaChat(socket, room);
            } catch (err) {
                console.error("Errore autorizzazione listen_all_rooms:", err);
                lasciaStanzaChat(socket, room);
            }
        }

        await rimuoviStanzeNonAutorizzate(socket, utente);
    });

    socket.on('join_room', async (room) => {
        if (!allowRoomEvent()) return emettiErroreChat(socket, 'Troppe richieste chat. Attendi qualche secondo.');

        const stanza = await richiediStanzaAutorizzata(socket, utente, room, {
            contesto: 'join_room',
            messaggioPermessi: 'Non hai i permessi per accedere a questa chat.',
            messaggioErrore: 'Errore autorizzazione chat.'
        });
        if (!stanza) return;

        entraInStanzaChat(socket, stanza);
        try {
            const page = await caricaStoricoChat(stanza.room);
            socket.emit('room_history', page.messages, { room: stanza.room, hasMore: page.hasMore });
        } catch (error) {
            console.error('Errore caricamento storico chat:', error.code || error.name);
            emettiErroreChat(socket, 'Impossibile caricare lo storico.');
        }
    });

    socket.on('load_room_history', async (data, ack) => {
        if (typeof ack !== 'function') return;
        if (!allowRoomEvent()) return ack({ errore: 'Troppe richieste chat. Attendi qualche secondo.' });
        const beforeId = parsePositiveSafeId(data?.beforeId);
        if (!beforeId) return ack({ errore: 'Punto di partenza non valido.' });
        const stanza = await richiediStanzaAutorizzata(socket, utente, data?.room, { contesto: 'load_room_history' });
        if (!stanza) return ack({ errore: 'Impossibile caricare lo storico.' });
        try {
            return ack(await caricaStoricoChat(stanza.room, beforeId));
        } catch (error) {
            console.error('Errore caricamento messaggi precedenti:', error.code || error.name);
            return ack({ errore: 'Impossibile caricare i messaggi precedenti.' });
        }
    });

    socket.on('send_message', async (data, ack) => {
        const reject = errore => {
            if (typeof ack === 'function') return ack({ errore });
            emettiErroreChat(socket, errore);
        };
        if (!allowChatEvent()) {
            return reject('Troppi messaggi inviati. Attendi qualche secondo.');
        }

        const {
            room,
            contenuto,
            file_url: requestedFileUrl,
            file_type: requestedFileType,
            upload_token: uploadToken
        } = data || {};
        const stanza = await richiediStanzaAutorizzata(socket, utente, room, {
            contesto: 'send_message',
            messaggioPermessi: 'Non hai i permessi per scrivere in questa chat.',
            messaggioErrore: 'Errore autorizzazione messaggio.'
        });
        if (!stanza) {
            if (typeof ack === 'function') ack({ errore: 'Impossibile inviare il messaggio in questa chat.' });
            return;
        }
        entraInStanzaChat(socket, stanza);

        const contenutoPulito = cleanText(contenuto, { max: 2000 });
        if (contenutoPulito === null) {
            return reject('Messaggio troppo lungo.');
        }

        const clientId = data?.client_id ?? null;
        if (clientId !== null && (
            typeof clientId !== 'string' ||
            !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(clientId) ||
            requestedFileUrl || requestedFileType || uploadToken
        )) return reject('Identificativo messaggio non valido.');

        let fileUrl = null;
        let fileType = null;
        if (requestedFileUrl || requestedFileType || uploadToken) {
            const normalizedFileUrl = cleanText(requestedFileUrl, {
                min: 1,
                max: 255,
                required: true
            });
            const normalizedFileType = cleanText(requestedFileType, {
                min: 3,
                max: 100,
                required: true
            });
            const validUpload = Boolean(
                isGeneratedUploadName(normalizedFileUrl) &&
                normalizedFileType &&
                consumeChatUploadToken(uploadToken, {
                    filename: normalizedFileUrl,
                    mimetype: normalizedFileType,
                    userId,
                    room: stanza.room
                })
            );

            if (!validUpload) {
                return reject('Allegato non valido o scaduto. Caricalo nuovamente.');
            }

            fileUrl = normalizedFileUrl;
            fileType = normalizedFileType;
        }

        if (!contenutoPulito && !fileUrl) {
            return reject('Il messaggio è vuoto.');
        }

        if (stanza.type === 'private') {
            try {
                await salvaChatPrivata(stanza);
            } catch (error) {
                console.error('Errore salvataggio chat privata:', error.code || error.name);
                return reject('Impossibile salvare la conversazione.');
            }
        }

        db.query('INSERT INTO messages (user_id, room, contenuto, file_url, file_type, client_id) VALUES (?,?,?,?,?,?)',
        [userId, stanza.room, contenutoPulito, fileUrl, fileType, clientId], async (err, res) => {
            if (err) {
                if (clientId && err.code === 'ER_DUP_ENTRY') {
                    try {
                        const [existing] = await queryAsync(
                            'SELECT id, room, contenuto FROM messages WHERE user_id = ? AND client_id = ?',
                            [userId, clientId]
                        );
                        if (existing?.room === stanza.room && existing.contenuto === contenutoPulito) {
                            if (typeof ack === 'function') ack({ ok: true, id: existing.id });
                            return;
                        }
                    } catch (lookupError) {
                        console.error('Errore verifica invio ripetuto:', lookupError.code || lookupError.name);
                    }
                }
                console.error('Errore salvataggio messaggio nel DB:', err.code || err.name);
                return reject('Errore durante l\'invio del messaggio.');
            }
            
            const msg = { 
                id: res.insertId, user_id: userId, room: stanza.room,
                nome: utente.nome, cognome: utente.cognome, propic: utente.propic, 
                contenuto: contenutoPulito,
                file_url: fileUrl,
                file_type: fileType,
                data_invio: new Date()
            };
            
            io.to(stanza.room).emit('receive_message', msg);
            if (typeof ack === 'function') ack({ ok: true, id: msg.id });
            
            if (stanza.type === 'private') {
                const target = getPrivateRoomPeer(stanza.room, userId);
                if (target) io.to('user_' + target).emit('sveglia_nuova_chat', stanza.room);
            }
        });
    });

    socket.on('sto_scrivendo', async (room) => {
        const stanza = await richiediStanzaAutorizzata(socket, utente, room, {
            contesto: 'sto_scrivendo'
        });
        if (!stanza) return;

        socket.to(stanza.room).emit('utente_sta_scrivendo', { nome: utente.nome });
    });

    socket.on('ho_smesso_di_scrivere', async (room) => {
        const stanza = await richiediStanzaAutorizzata(socket, utente, room, {
            contesto: 'ho_smesso_di_scrivere'
        });
        if (!stanza) return;

        socket.to(stanza.room).emit('utente_ha_smesso');
    });

    // Eliminazione messaggi e allegati da parte di admin/coach.
    socket.on('delete_message', async (msgId) => {
        if (utente.ruolo !== 'ADMIN' && utente.ruolo !== 'COACH') {
            return emettiErroreChat(socket, 'Solo admin e coach possono eliminare messaggi.');
        }

        const idMessaggio = Number(msgId);
        if (!Number.isInteger(idMessaggio) || idMessaggio <= 0) {
            return emettiErroreChat(socket, 'Messaggio non valido.');
        }
        
        // Recupera l'eventuale allegato prima di eliminare il messaggio.
        const queryTrovaFile = "SELECT file_url, room FROM messages WHERE id = ?";
        
        db.query(queryTrovaFile, [idMessaggio], async (err, results) => {
            if (err) {
                console.error("Errore ricerca file da eliminare:", err);
                return;
            }

            if (results.length > 0) {
                const nomeFile = results[0].file_url;
                const stanza = results[0].room;
                try {
                    const puoGestireStanza = await utentePuoModerareStanza(utente, stanza);
                    if (!puoGestireStanza) {
                        return emettiErroreChat(socket, 'Non puoi eliminare messaggi da questa chat.');
                    }
                } catch (errAuth) {
                    console.error("Errore autorizzazione delete_message:", errAuth);
                    return emettiErroreChat(socket, 'Errore autorizzazione eliminazione.');
                }

                // Elimina definitivamente la riga dal database.
                const queryEliminaDB = "DELETE FROM messages WHERE id = ?";
                db.query(queryEliminaDB, [idMessaggio], (errDB) => {
                    if (errDB) {
                        console.error("Errore cancellazione messaggio dal DB:", errDB);
                        return;
                    }
                    
                    if (nomeFile) removeUploadedFileIfUnused(nomeFile, db);
                    // Aggiorna tutti i client connessi alla stanza.
                    io.to(stanza).emit('message_deleted', idMessaggio);
                });
            }
        });
    });

    const pendingCallOffers = new Map();

    socket.on('webrtc_offer', async (data, ack) => {
        const reply = result => {
            if (typeof ack === 'function') ack(result);
            else if (result.errore) socket.emit('webrtc_error', { errore: result.errore });
        };
        if (!allowSignalingEvent()) {
            return reply({ errore: 'Troppi eventi di chiamata. Riprova tra poco.' });
        }

        const targetId = parsePositiveSafeId(data?.targetId);
        if (!targetId || !isValidSdp(data?.sdp, 'offer')) {
            return reply({ errore: 'Richiesta di chiamata non valida.' });
        }

        const offer = Symbol();
        pendingCallOffers.set(targetId, offer);
        try {
            if (!await utentePuoChiamare(utente, targetId)) {
                return reply({ errore: 'Destinatario non autorizzato.' });
            }
            if (!socket.connected || pendingCallOffers.get(targetId) !== offer) {
                return reply({ errore: 'Chiamata annullata.' });
            }

            const call = chiamateAttive.start(userId, targetId);
            if (!call) {
                return reply({ errore: 'Utente già impegnato in un’altra chiamata.' });
            }

            io.to('user_' + targetId).emit('webrtc_offer', {
                sdp: data.sdp,
                callerId: utente.id,
                callerName: `${utente.nome} ${utente.cognome}`,
                callerPropic: utente.propic
            });
            reply({ ok: true });
        } catch (error) {
            console.error('Errore autorizzazione offerta WebRTC:', error);
            reply({ errore: 'Impossibile avviare la chiamata.' });
        } finally {
            if (pendingCallOffers.get(targetId) === offer) pendingCallOffers.delete(targetId);
        }
    });

    socket.on('webrtc_answer', (data) => {
        if (!allowSignalingEvent()) return;
        const targetId = parsePositiveSafeId(data?.targetId);
        if (!targetId || !isValidSdp(data?.sdp, 'answer')) {
            return socket.emit('webrtc_error', { errore: 'Risposta di chiamata non valida.' });
        }
        const call = chiamateAttive.touch(userId, targetId);
        if (!call) return socket.emit('webrtc_error', { errore: 'Chiamata non più attiva.' });

        io.to('user_' + targetId).emit('webrtc_answer', {
            sdp: data.sdp,
            answererId: utente.id
        });
    });

    socket.on('webrtc_ice_candidate', (data) => {
        if (!allowSignalingEvent()) return;
        const targetId = parsePositiveSafeId(data?.targetId);
        if (!targetId || !isValidIceCandidate(data?.candidate)) return;
        const call = chiamateAttive.touch(userId, targetId);
        if (!call) return;

        io.to('user_' + targetId).emit('webrtc_ice_candidate', {
            candidate: data.candidate,
            senderId: utente.id
        });
    });

    socket.on('webrtc_end_call', (data) => {
        const targetId = parsePositiveSafeId(data?.targetId);
        if (!targetId) return;
        pendingCallOffers.delete(targetId);

        if (!chiamateAttive.end(userId, targetId)) return;
        io.to('user_' + targetId).emit('webrtc_end_call', { senderId: userId });
    });

    socket.on('webrtc_toggle_video', (data) => {
        if (!allowSignalingEvent()) return;
        const targetId = parsePositiveSafeId(data?.targetId);
        if (!targetId || typeof data?.isVideoOn !== 'boolean') return;
        const call = chiamateAttive.touch(userId, targetId);
        if (!call) return;

        io.to('user_' + targetId).emit('webrtc_toggle_video', {
            isVideoOn: data.isVideoOn,
            senderId: userId
        });
    });

    socket.on('webrtc_audio_state', (data) => {
        if (!allowSignalingEvent()) return;
        const targetId = parsePositiveSafeId(data?.targetId);
        if (!targetId || typeof data.micOn !== 'boolean' || typeof data.listening !== 'boolean') return;
        if (!chiamateAttive.touch(userId, targetId)) return;
        io.to('user_' + targetId).emit('webrtc_audio_state', {
            senderId: userId,
            micOn: data.micOn,
            listening: data.listening
        });
    });

    socket.on('disconnect', () => {
        chiamateAttive.removeUser(userId).forEach(otherUserId => {
            io.to('user_' + otherUserId).emit('webrtc_end_call', { senderId: userId });
        });
        if (utentiOnline[userId] > 1) {
            utentiOnline[userId]--;
        } else {
            delete utentiOnline[userId];
            delete statiPersonali[userId];
            socket.broadcast.emit('utente_disconnesso', { id: userId });
        }
    });
});

const GIORNI_SCADENZA = Number(process.env.MESSAGE_RETENTION_DAYS || 15);
if (!Number.isInteger(GIORNI_SCADENZA) || GIORNI_SCADENZA < 1 || GIORNI_SCADENZA > 3650) {
    throw new Error('MESSAGE_RETENTION_DAYS deve essere un intero tra 1 e 3650.');
}

async function pulisciVecchiMessaggi() {
    try {
        const cutoff = new Date(Date.now() - GIORNI_SCADENZA * 86400000);
        while (true) {
            const rows = await queryAsync(
                'SELECT id, file_url FROM messages WHERE data_invio < ? ORDER BY data_invio, id LIMIT 250',
                [cutoff]
            );
            if (rows.length === 0) return;
            await queryAsync('DELETE FROM messages WHERE id IN (?) AND data_invio < ?', [rows.map(row => row.id), cutoff]);
            const files = new Set(rows.map(row => row.file_url).filter(Boolean));
            for (const filename of files) await removeUploadedFileIfUnused(filename, db);
        }
    } catch (error) {
        console.error('Errore manutenzione messaggi:', error.code || error.name);
    }
}

if (process.env.NODE_ENV !== 'test') {
    pulisciVecchiMessaggi();
    setInterval(pulisciVecchiMessaggi, 24 * 60 * 60 * 1000);
}

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({ errore: 'Corpo JSON non valido.' });
    }
    console.error('Errore HTTP non gestito:', error.code || error.message);
    res.status(500).json({ errore: 'Errore interno del server.' });
});

function startListening() {
    server.listen(PORT, () => {
        console.info(`Server attivo sulla porta ${server.address().port}`);
    });
}

db.checkConnection()
    .then(() => {
        console.info('Connessione al database verificata.');
        startListening();
    })
    .catch((error) => {
        console.error('Impossibile avviare il server: verifica connessione e migrazioni MySQL.');
        console.error(error.code || 'DB_ERROR', error.message);
        process.exit(1);
    });
