require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const fs = require('fs');
const http = require('http'); 
const { Server } = require('socket.io'); 
const db = require('./config/db');
const {
    consumeChatUploadToken,
    safeUploadPath
} = require('./utils/file-security');
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

app.use(express.static('public', { dotfiles: 'deny' }));
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

app.use('/api', require('./routes/auth'));       
app.use('/api', require('./routes/public'));     
app.use('/api', require('./routes/user'));       
app.use('/api/admin', require('./routes/admin'));
app.use('/api/coach', require('./routes/coach'));

app.get('/api/health', (req, res) => {
    db.query('SELECT 1 AS ok', (error) => {
        if (error) {
            console.error('Health check database fallito:', error.code, error.message);
            return res.status(503).json({ status: 'error', database: 'unavailable' });
        }

        res.json({
            status: 'ok',
            database: 'connected',
            release: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'local'
        });
    });
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

io.use((socket, next) => {
    const utente = normalizzaUtenteSocket(socket.request.session?.utenteLoggato);
    if (!utente) return next(new Error('Non autorizzato'));

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
        const q = `SELECT m.*, u.nome, u.cognome, u.propic FROM messages m JOIN users u ON m.user_id = u.id WHERE m.room = ? ORDER BY m.data_invio ASC`;
        db.query(q, [stanza.room], (err, res) => {
            if (err) return console.error("Errore caricamento storico chat:", err);
            socket.emit('room_history', res);
        });
    });

    socket.on('send_message', async (data) => {
        if (!allowChatEvent()) {
            return emettiErroreChat(socket, 'Troppi messaggi inviati. Attendi qualche secondo.');
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
        if (!stanza) return;
        entraInStanzaChat(socket, stanza);

        const contenutoPulito = cleanText(contenuto, { max: 2000 });
        if (contenutoPulito === null) {
            return emettiErroreChat(socket, 'Messaggio troppo lungo.');
        }

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
            const filePath = safeUploadPath(normalizedFileUrl);
            const validUpload = Boolean(
                normalizedFileUrl &&
                normalizedFileType &&
                filePath &&
                fs.existsSync(filePath) &&
                consumeChatUploadToken(uploadToken, {
                    filename: normalizedFileUrl,
                    mimetype: normalizedFileType,
                    userId,
                    room: stanza.room
                })
            );

            if (!validUpload) {
                return emettiErroreChat(socket, 'Allegato non valido o scaduto. Caricalo nuovamente.');
            }

            fileUrl = normalizedFileUrl;
            fileType = normalizedFileType;
        }

        if (!contenutoPulito && !fileUrl) {
            return emettiErroreChat(socket, 'Il messaggio è vuoto.');
        }

        db.query('INSERT INTO messages (user_id, room, contenuto, file_url, file_type) VALUES (?,?,?,?,?)',
        [userId, stanza.room, contenutoPulito, fileUrl, fileType], (err, res) => {
            if (err) {
                console.error("Errore salvataggio messaggio nel DB:", err);
                return emettiErroreChat(socket, 'Errore durante l\'invio del messaggio.');
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

                // Elimina anche il file fisico collegato al messaggio.
                if (nomeFile) {
                    const percorsoFileFisico = safeUploadPath(nomeFile);
                    
                    if (percorsoFileFisico) fs.unlink(percorsoFileFisico, (errDelete) => {
                        if (errDelete) {
                            if (errDelete.code !== 'ENOENT') {
                                console.error("Errore durante l'eliminazione del file fisico:", errDelete);
                            }
                        }
                    });
                }

                // Elimina definitivamente la riga dal database.
                const queryEliminaDB = "DELETE FROM messages WHERE id = ?";
                db.query(queryEliminaDB, [idMessaggio], (errDB) => {
                    if (errDB) {
                        console.error("Errore cancellazione messaggio dal DB:", errDB);
                        return;
                    }
                    
                    // Aggiorna tutti i client connessi alla stanza.
                    io.to(stanza).emit('message_deleted', idMessaggio);
                });
            }
        });
    });

    socket.on('webrtc_offer', async (data) => {
        if (!allowSignalingEvent()) {
            return socket.emit('webrtc_error', { errore: 'Troppi eventi di chiamata. Riprova tra poco.' });
        }

        const targetId = parsePositiveSafeId(data?.targetId);
        if (!targetId || !isValidSdp(data?.sdp, 'offer')) {
            return socket.emit('webrtc_error', { errore: 'Richiesta di chiamata non valida.' });
        }

        try {
            if (!await utentePuoChiamare(utente, targetId)) {
                return socket.emit('webrtc_error', { errore: 'Destinatario non autorizzato.' });
            }

            const call = chiamateAttive.start(userId, targetId);
            if (!call) {
                return socket.emit('webrtc_error', { errore: 'Utente già impegnato in un’altra chiamata.' });
            }

            io.to('user_' + targetId).emit('webrtc_offer', {
                sdp: data.sdp,
                callerId: utente.id,
                callerName: `${utente.nome} ${utente.cognome}`,
                callerPropic: utente.propic
            });
        } catch (error) {
            console.error('Errore autorizzazione offerta WebRTC:', error);
            socket.emit('webrtc_error', { errore: 'Impossibile avviare la chiamata.' });
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

const GIORNI_SCADENZA = 15; 

function pulisciVecchiMessaggi() {
    db.query(`SELECT file_url FROM messages WHERE file_url IS NOT NULL AND data_invio < DATE_SUB(NOW(), INTERVAL ? DAY)`, [GIORNI_SCADENZA], (err, res) => {
        if (err) return console.error("Errore manutenzione messaggi (lettura DB):", err);

        res.forEach(r => {
            const fp = safeUploadPath(r.file_url);
            if (!fp) return;
            fs.unlink(fp, (errFs) => {
                if (errFs && errFs.code !== 'ENOENT') {
                    console.error(`Impossibile cancellare il file fisico ${r.file_url}:`, errFs);
                }
            });
        });

        db.query(`DELETE FROM messages WHERE data_invio < DATE_SUB(NOW(), INTERVAL ? DAY)`, [GIORNI_SCADENZA], (errDel, resDel) => {
            if (errDel) return console.error("Errore manutenzione messaggi (eliminazione DB):", errDel);
            if (resDel.affectedRows > 0) {
                console.info(`Pulizia completata: rimossi ${resDel.affectedRows} messaggi più vecchi di ${GIORNI_SCADENZA} giorni.`);
            }
        });
    });
}

if (process.env.NODE_ENV !== 'test') {
    pulisciVecchiMessaggi();
    setInterval(pulisciVecchiMessaggi, 24 * 60 * 60 * 1000);
}

app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({ errore: 'Corpo JSON non valido.' });
    }
    console.error('Errore HTTP non gestito:', error.code || error.message);
    res.status(500).json({ errore: 'Errore interno del server.' });
});

function startListening() {
    server.listen(PORT, () => {
        console.info(`Server attivo sulla porta ${PORT}`);
    });
}

db.checkConnection()
    .then(() => {
        console.info('Connessione al database verificata.');
        startListening();
    })
    .catch((error) => {
        console.error('Impossibile avviare il server: database non disponibile.');
        console.error(error.code || 'DB_ERROR', error.message);
        process.exit(1);
    });
