// Backend Node.js: collega Express, sessioni MySQL, API e Socket.IO nello stesso server HTTP.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// Carica le variabili di ambiente locali usate dalla configurazione del backend.
require('dotenv').config();
// express: Express definisce router, middleware e risposte HTTP.
const express = require('express');
// session: express-session collega il cookie del browser ai dati della sessione sul server.
const session = require('express-session');
// MySQLStore: L’archivio MySQL mantiene le sessioni disponibili dopo il riavvio del processo.
const MySQLStore = require('express-mysql-session')(session);
// path: path costruisce e verifica percorsi con i separatori corretti del sistema operativo.
const path = require('node:path');
// http: http crea il server HTTP o il servizio locale usato dalle prove.
const http = require('http'); 
// Server: Classe che crea il server Socket.IO sul server HTTP condiviso.
const { Server } = require('socket.io'); 
// db: Importa il modulo locale. Configura il pool MySQL/TiDB condiviso: le connessioni vengono riutilizzate invece
// di aprirne una per richiesta.
const db = require('./config/db');
// getStorageLimitBytes: Restituisce il limite di spazio in byte e rifiuta configurazioni che non sono interi
// positivi sicuri.
const { getStorageLimitBytes } = require('./config/media-quota');
// consumeChatUploadToken: Verifica firma, scadenza, utente, stanza e file e impedisce il riuso del token nel
// processo corrente.
// isGeneratedUploadName: Controlla che il nome rispetti il formato degli upload generati e il percorso consentito.
// removeUploadedFileIfUnused: Cancella il file soltanto se è un upload riconosciuto e non risultano riferimenti
// nel database.
const {
    consumeChatUploadToken,
    isGeneratedUploadName,
    removeUploadedFileIfUnused
} = require('./utils/file-security');
// salvaChatPrivata: Registra la coppia ordinata dei partecipanti alla conversazione privata senza duplicarla.
// utentePuoAccedereAStanza: Verifica nel database l’accesso dell’utente alla chat generale, privata, di corso o di
// gara.
const { salvaChatPrivata, utentePuoAccedereAStanza } = require('./utils/chat-access');
// hasCurrentRole: Confronta il ruolo nella sessione con quello attuale nel database; restituisce true solo se
// coincidono.
const { hasCurrentRole } = require('./utils/session-access');
// cleanText: Converte e rifinisce il testo, controllando obbligatorietà e lunghezze; distingue assenza valida e
// input non valido.
const {
    cleanText
} = require('./utils/validation');
// CallRegistry: Importa il modulo locale. Valida dati di chat e signaling WebRTC; mantiene in memoria chiamate
// attive e limiti degli eventi.
// createRateLimiter: Restituisce una funzione che conta gli eventi nella finestra temporale e indica se il limite
// è rispettato.
// getPrivateRoomPeer: Restituisce l’altro partecipante se l’utente appartiene alla stanza privata indicata.
// isValidIceCandidate: Controlla struttura e dimensione del candidato ICE ricevuto prima dell’inoltro.
// isValidSdp: Controlla tipo, struttura e lunghezza della descrizione SDP usata nel signaling WebRTC.
// normalizeChatRoom: Riconosce e normalizza i formati di stanza consentiti, verificando anche gli id dei
// partecipanti privati.
// parsePositiveSafeId: Converte un valore in intero positivo rappresentabile senza perdita di precisione oppure
// restituisce null.
const {
    CallRegistry,
    createRateLimiter,
    getPrivateRoomPeer,
    isValidIceCandidate,
    isValidSdp,
    normalizeChatRoom,
    parsePositiveSafeId
} = require('./utils/socket-security');

// app: Istanza Express che registra middleware e route HTTP.
const app = express();
// server: Server che riceve le connessioni HTTP e ospita Socket.IO quando previsto.
const server = http.createServer(app);
// isProduction: Indica se l’ambiente richiede le impostazioni previste per la produzione.
const isProduction = process.env.NODE_ENV === 'production';
// socketOptions: Opzioni passate a Socket.IO, incluse le origini autorizzate.
const socketOptions = {};
if (!isProduction) {
    socketOptions.cors = {
        origin: true,
        // credentials: Controlla l’uso delle credenziali HTTP, inclusi i cookie, per questa configurazione.
        credentials: true
    };
} else if (process.env.PUBLIC_ORIGIN) {
    socketOptions.cors = {
        origin: process.env.PUBLIC_ORIGIN,
        // credentials: Controlla l’uso delle credenziali HTTP, inclusi i cookie, per questa configurazione.
        credentials: true
    };
}
// io: Server o collegamento Socket.IO per lo scambio degli eventi in tempo reale.
const io = new Server(server, socketOptions);

// PORT: Porta su cui il server HTTP resta in ascolto.
const PORT = process.env.PORT || 3000;

if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET deve essere configurata in produzione.');
}

// Render termina TLS sul proxy e inoltra la richiesta all'applicazione.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Middleware Express: controlla o prepara la richiesta prima dei gestori successivi.
// Riceve: req (richiesta HTTP); res (risposta HTTP); next (passaggio al middleware successivo).
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

// publicDir: Directory che contiene i file statici distribuiti al browser.
const publicDir = path.join(__dirname, 'public');
// Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
// folder: Riferimento o risultato da valorizzare durante l’operazione.
for (const folder of ['css', 'js', 'sounds', 'uploads/buttons', 'uploads/catalog', 'uploads/defaults', 'uploads/sliders']) {
    app.use('/' + folder, express.static(path.join(publicDir, folder), { dotfiles: 'deny', index: false }));
}
// Gestisce la rotta GET e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
// Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
// asset: Riferimento o risultato da valorizzare durante l’operazione.
for (const asset of ['manifest.json', 'icon.svg', 'sw.js']) {
    // Gestisce la rotta GET e invia la risposta HTTP prevista.
    // Riceve: req (richiesta HTTP); res (risposta HTTP).
    app.get('/' + asset, (req, res) => res.sendFile(path.join(publicDir, asset)));
}
app.use(express.json({ limit: '100kb' }));

// Le API che modificano dati accettano richieste browser solo dalla stessa origine.
// I client non-browser senza header Origin restano compatibili (script locali, health check).
// Middleware Express: controlla o prepara la richiesta prima dei gestori successivi.
// Riceve: req (richiesta HTTP); res (risposta HTTP); next (passaggio al middleware successivo).
app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    // origin: Origine dichiarata dalla richiesta del browser per il controllo di provenienza.
    const origin = req.get('origin');
    // In questo caso delega subito al middleware successivo.
    if (!origin) return next();

    // requestOrigin: Origine costruita da protocollo e host della richiesta ricevuta.
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    // In questo caso delega subito al middleware successivo.
    if (origin === requestOrigin) return next();

    return res.status(403).json({ errore: 'Origine della richiesta non consentita.' });
});

// Le sessioni persistono nel database per supportare riavvii e più istanze.
// sessionStore: Archivio MySQL delle sessioni HTTP, separato dal cookie identificativo del browser.
const sessionStore = new MySQLStore({
    // clearExpired: Abilita la rimozione delle sessioni scadute nell’archivio.
    clearExpired: true,
    // checkExpirationInterval: Intervallo in millisecondi fra i controlli delle sessioni scadute.
    checkExpirationInterval: 900000,
    // expiration: Durata di scadenza prevista dall’archivio delle sessioni.
    expiration: 86400000,
    // createDatabaseTable: Permette all’archivio delle sessioni di creare la propria tabella se manca.
    createDatabaseTable: true
}, db);

// sessionMiddleware: Middleware che legge il cookie e collega la sessione alla richiesta HTTP.
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'chiave_segreta_super_sicura_fallback', 
    store: sessionStore,
    // resave: Decide se riscrivere la sessione anche quando non è stata modificata.
    resave: false,
    // saveUninitialized: Decide se conservare una nuova sessione ancora priva di dati.
    saveUninitialized: false,
    // proxy: Permette al middleware di considerare il proxy nella gestione della connessione sicura.
    proxy: true,
    cookie: {
        // secure: Controlla se il cookie può essere inviato soltanto tramite HTTPS.
        secure: isProduction,
        // httpOnly: Impedisce al JavaScript della pagina di leggere il cookie di sessione.
        httpOnly: true,
        // sameSite: Regola l’invio del cookie nelle richieste tra siti; è una protezione aggiuntiva, non una validazione
        // dei dati.
        sameSite: 'lax',
        // maxAge: Durata massima del cookie espressa in millisecondi.
        maxAge: 24 * 60 * 60 * 1000
    }
});

app.use(sessionMiddleware);
// Condivide il middleware delle sessioni con il trasporto Socket.IO.
io.engine.use(sessionMiddleware);
// Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
// Riceve: userId (id dell’utente).
app.locals.revokeUserSockets = userId => io.in('user_' + userId).disconnectSockets(true);

app.use(require('./routes/media'));
app.use('/api', require('./routes/auth'));       
app.use('/api', require('./routes/public'));     
app.use('/api', require('./routes/user'));       
app.use('/api/admin', require('./routes/admin'));
app.use('/api/coach', require('./routes/coach'));

// Gestisce la rotta GET /api/health e invia la risposta HTTP prevista.
// Riceve: req (richiesta HTTP); res (risposta HTTP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
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
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Health check fallito:', error.code || error.name);
        res.status(503).json({ status: 'error', database: error.code === 'MEDIA_INVALID_STORAGE_LIMIT' ? 'connected' : 'unavailable' });
    }
});

// utentiOnline: Associa ciascun utente alle sue connessioni attualmente online.
const utentiOnline = {}; 
// statiPersonali: Conserva gli stati personali comunicati dai client collegati.
const statiPersonali = {};
// chiamateAttive: Registro in memoria delle coppie di utenti coinvolte nelle chiamate.
const chiamateAttive = new CallRegistry();

// queryAsync: Converte la query a callback in una Promise: resolve consegna le righe e reject propaga l’errore.
// Riceve: sql (istruzione SQL); params (valori separati della query).
// Restituisce una Promise risolta con i risultati SQL o rifiutata con l’errore del database.
function queryAsync(sql, params = []) {
    // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
    // Riceve: resolve (completa la Promise con successo); reject (completa la Promise con errore).
    return new Promise((resolve, reject) => {
        // Riceve l’esito della query a callback e gestisce errore o righe restituite.
        // Riceve: err (errore intercettato); results (risultati dell’operazione).
        db.query(sql, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

// caricaStoricoChat: Legge una pagina ordinata di messaggi usando il cursore e determina se esistono messaggi
// precedenti.
// Riceve: room (identificativo della stanza); beforeId (id del messaggio usato come cursore).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
// La Promise restituisce messages e hasMore per la pagina della stanza.
async function caricaStoricoChat(room, beforeId) {
    // params: Valori separati dall’istruzione SQL e associati ai suoi segnaposto.
    const params = [room];
    // cursorFilter: Testo o valore iniziale utilizzato da questo blocco.
    let cursorFilter = '';
    if (beforeId) {
        // anchor: Messaggio di riferimento usato come punto di partenza della paginazione.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const [anchor] = await queryAsync('SELECT data_invio FROM messages WHERE id = ? AND room = ?', [beforeId, room]);
        if (!anchor) return { messages: [], hasMore: false };
        cursorFilter = 'AND (m.data_invio < ? OR (m.data_invio = ? AND m.id < ?))';
        params.push(anchor.data_invio, anchor.data_invio, beforeId);
    }
    // rows: Righe restituite dalla query o dal caricamento corrente.
    const rows = await queryAsync(
        'SELECT m.*, u.nome, u.cognome, u.propic FROM messages m JOIN users u ON m.user_id = u.id ' +
        'WHERE m.room = ? ' + cursorFilter + ' ORDER BY m.data_invio DESC, m.id DESC LIMIT 51',
        params
    );
    return { messages: rows.slice(0, 50).reverse(), hasMore: rows.length > 50 };
}

// utentePuoModerareStanza: Verifica se amministratore o coach possono moderare la stanza richiesta.
// Riceve: utente (dati dell’utente); room (identificativo della stanza).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function utentePuoModerareStanza(utente, room) {
    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = parsePositiveSafeId(utente?.id);
    // ruolo: Ruolo applicativo usato per stabilire le azioni consentite.
    const ruolo = String(utente?.ruolo || '').toUpperCase();
    // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
    const stanza = normalizeChatRoom(room);
    if (!userId || !stanza) return false;

    // Il caso indicato soddisfa già il controllo: restituisce subito true.
    if (ruolo === 'ADMIN') return true;
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (ruolo !== 'COACH') return false;

    if (stanza.type === 'private') {
        return stanza.userIds.includes(userId);
    }

    if (stanza.type === 'corso') {
        // results: Risultati consegnati dall’operazione asincrona.
        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
        const results = await queryAsync(
            'SELECT id FROM corsi WHERE id = ? AND coach_id = ? LIMIT 1',
            [stanza.id, userId]
        );
        return results.length > 0;
    }

    return false;
}

// autorizzaStanzaChat: Normalizza la stanza e la restituisce soltanto se l’utente può accedervi.
// Riceve: utente (dati dell’utente); room (identificativo della stanza).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function autorizzaStanzaChat(utente, room) {
    // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
    const stanza = normalizeChatRoom(room);
    if (!stanza) return null;

    return await utentePuoAccedereAStanza(utente, stanza.room) ? stanza : null;
}

// stanzeChatSocket: Recupera o inizializza l’insieme delle stanze applicative autorizzate per questo socket.
// Riceve: socket (connessione Socket.IO del client).
function stanzeChatSocket(socket) {
    if (!socket.data.stanzeChat) socket.data.stanzeChat = new Set();
    return socket.data.stanzeChat;
}

// entraInStanzaChat: Registra l’appartenenza autorizzata e fa entrare il socket nella stanza Socket.IO.
// Riceve: socket (connessione Socket.IO del client); stanza (dati della stanza).
function entraInStanzaChat(socket, stanza) {
    socket.join(stanza.room);
    stanzeChatSocket(socket).add(stanza.room);
}

// lasciaStanzaChat: Rimuove l’appartenenza sia dal registro del socket sia dalla stanza Socket.IO.
// Riceve: socket (connessione Socket.IO del client); room (identificativo della stanza).
function lasciaStanzaChat(socket, room) {
    // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
    const stanza = normalizeChatRoom(room);
    if (!stanza) return;

    socket.leave(stanza.room);
    stanzeChatSocket(socket).delete(stanza.room);
}

// rimuoviStanzeNonAutorizzate: Ricontrolla le stanze del socket e abbandona quelle che l’utente non può più
// utilizzare.
// Riceve: socket (connessione Socket.IO del client); utente (dati dell’utente).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function rimuoviStanzeNonAutorizzate(socket, utente) {
    // stanzeCorrenti: Elenco dei valori che questo blocco deve confrontare, mostrare o elaborare.
    const stanzeCorrenti = [...stanzeChatSocket(socket)];
    // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
    // room: Identificativo della stanza su cui opera questo blocco.
    for (const room of stanzeCorrenti) {
        try {
            if (!await utentePuoAccedereAStanza(utente, room)) {
                lasciaStanzaChat(socket, room);
            }
        } catch (err) {
            // err: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            console.error('Errore verifica stanza Socket:', err);
            lasciaStanzaChat(socket, room);
        }
    }
}

// emettiErroreChat: Comunica al client un errore della chat tramite un evento dedicato.
// Riceve: socket (connessione Socket.IO del client); messaggio (dati o testo del messaggio).
function emettiErroreChat(socket, messaggio) {
    socket.emit('chat_error', { errore: messaggio });
}

// richiediStanzaAutorizzata: Controlla l’accesso alla stanza e, quando previsto dalle opzioni, l’iscrizione
// corrente del socket.
// Riceve: socket (connessione Socket.IO del client); utente (dati dell’utente); room (identificativo della
// stanza); opzioni (opzioni di rappresentazione).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function richiediStanzaAutorizzata(socket, utente, room, opzioni = {}) {
    // contesto: Riferimento al valore opzioni utilizzato da questo blocco.
    // messaggioPermessi: Riferimento al valore opzioni utilizzato da questo blocco.
    // messaggioErrore: Riferimento al valore opzioni utilizzato da questo blocco.
    const {
        contesto = 'chat',
        messaggioPermessi,
        messaggioErrore
    } = opzioni;

    try {
        // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
        const stanza = await autorizzaStanzaChat(utente, room);
        if (!stanza) {
            lasciaStanzaChat(socket, room);
            if (messaggioPermessi) emettiErroreChat(socket, messaggioPermessi);
            return null;
        }
        return stanza;
    } catch (err) {
        // err: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error(`Errore autorizzazione ${contesto}:`, err);
        if (messaggioErrore) emettiErroreChat(socket, messaggioErrore);
        return null;
    }
}

// utentePuoChiamare: Verifica utenti distinti e regole di ruolo prima di autorizzare una chiamata.
// Riceve: utente (dati dell’utente); targetId (id del destinatario).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function utentePuoChiamare(utente, targetId) {
    // callerId: Identificativo dell’utente che avvia la chiamata.
    const callerId = parsePositiveSafeId(utente?.id);
    // destinatarioId: Identificativo validato del destinatario della chiamata.
    const destinatarioId = parsePositiveSafeId(targetId);
    if (!callerId || !destinatarioId || callerId === destinatarioId) return false;

    // results: Risultati consegnati dall’operazione asincrona.
    // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
    const results = await queryAsync(
        'SELECT id, ruolo FROM users WHERE id = ? LIMIT 1',
        [destinatarioId]
    );
    if (results.length === 0) return false;
    // ruolo: Ruolo applicativo usato per stabilire le azioni consentite.
    const ruolo = String(utente?.ruolo || '').toUpperCase();
    // ruoloDestinatario: Ruolo attuale del destinatario letto dal database.
    const ruoloDestinatario = String(results[0].ruolo || '').toUpperCase();
    // Il caso indicato soddisfa già il controllo: restituisce subito true.
    if (ruolo === 'ADMIN' || ruolo === 'COACH') return true;
    return ruoloDestinatario === 'ADMIN' || ruoloDestinatario === 'COACH';
}

// normalizzaUtenteSocket: Ricava l’identità e il ruolo validi dalla sessione prima di accettare il socket.
// Riceve: utente (dati dell’utente).
function normalizzaUtenteSocket(utente) {
    // id: Valore convertito o normalizzato prima del suo utilizzo.
    const id = parsePositiveSafeId(utente?.id);
    // ruolo: Ruolo applicativo usato per stabilire le azioni consentite.
    const ruolo = String(utente?.ruolo || '').toUpperCase();
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (!id || !['ADMIN', 'COACH', 'PARTNER'].includes(ruolo)) return null;

    return {
        ...utente,
        id,
        ruolo
    };
}

// Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
// Riceve: socket (connessione Socket.IO del client); next (passaggio al middleware successivo).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
io.use(async (socket, next) => {
    // utente: Dati dell’utente su cui vengono applicati i controlli.
    const utente = normalizzaUtenteSocket(socket.request.session?.utenteLoggato);
    try {
        if (!utente || !await hasCurrentRole(utente)) return next(new Error('Non autorizzato'));
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Errore verifica ruolo socket:', error.code || error.name);
        return next(new Error('Sessione non disponibile'));
    }

    socket.data.utente = utente;
    next();
});

// Reagisce all’evento connection aggiornando i dati o i controlli previsti.
// Riceve: socket (connessione Socket.IO del client).
io.on('connection', (socket) => {
    // utente: Dati dell’utente su cui vengono applicati i controlli.
    const utente = socket.data.utente;
    
    if (!utente || !utente.id) {
        return socket.disconnect(true);
    }

    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = utente.id;
    // allowChatEvent: Risultato di createRateLimiter. Restituisce una funzione che conta gli eventi nella finestra
    // temporale e indica se il limite è rispettato.
    const allowChatEvent = createRateLimiter(90, 10 * 1000);
    // allowRoomEvent: Risultato di createRateLimiter. Restituisce una funzione che conta gli eventi nella finestra
    // temporale e indica se il limite è rispettato.
    const allowRoomEvent = createRateLimiter(30, 30 * 1000);
    // allowSignalingEvent: Risultato di createRateLimiter. Restituisce una funzione che conta gli eventi nella
    // finestra temporale e indica se il limite è rispettato.
    const allowSignalingEvent = createRateLimiter(120, 10 * 1000);
    socket.join('user_' + userId);

    if (!utentiOnline[userId]) {
        utentiOnline[userId] = 0;
        socket.broadcast.emit('utente_connesso', { id: userId, stato: statiPersonali[userId] || 'ONLINE' });
    }
    utentiOnline[userId]++;

    // mappa: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
    const mappa = {};
    // Scorre i nomi delle proprietà dell’oggetto.
    // id: Riferimento o risultato da valorizzare durante l’operazione.
    for (let id in utentiOnline) mappa[id] = statiPersonali[id] || 'ONLINE';
    socket.emit('utenti_online_iniziali', mappa);

    // Reagisce all’evento cambia_stato aggiornando i dati o i controlli previsti.
    // Riceve: stato (stato da rappresentare o comunicare).
    socket.on('cambia_stato', (stato) => {
        if (stato !== 'ONLINE' && stato !== 'DND') return;
        statiPersonali[userId] = stato;
        io.emit('stato_aggiornato', { id: userId, stato });
    });

    // Reagisce all’evento listen_all_rooms aggiornando i dati o i controlli previsti.
    // Riceve: roomsArray (stanze richieste dal client).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    socket.on('listen_all_rooms', async (roomsArray) => {
        if (!allowRoomEvent() || !Array.isArray(roomsArray)) return;

        // rooms: Risultato della chiamata .slice, riutilizzato nelle istruzioni successive.
        const rooms = [...new Set(
            roomsArray
                // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
                // Riceve: room (identificativo della stanza).
                .map(room => normalizeChatRoom(room)?.room)
                .filter(Boolean)
        )].slice(0, 100);

        // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
        // room: Identificativo della stanza su cui opera questo blocco.
        for (const room of rooms) {
            try {
                // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
                const stanza = await autorizzaStanzaChat(utente, room);
                if (stanza) entraInStanzaChat(socket, stanza);
                else lasciaStanzaChat(socket, room);
            } catch (err) {
                // err: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
                console.error("Errore autorizzazione listen_all_rooms:", err);
                lasciaStanzaChat(socket, room);
            }
        }

        await rimuoviStanzeNonAutorizzate(socket, utente);
    });

    // Controlla l’ingresso richiesto nella stanza.
    // Riceve: room (identificativo della stanza).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    socket.on('join_room', async (room) => {
        if (!allowRoomEvent()) return emettiErroreChat(socket, 'Troppe richieste chat. Attendi qualche secondo.');

        // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
        const stanza = await richiediStanzaAutorizzata(socket, utente, room, {
            contesto: 'join_room',
            messaggioPermessi: 'Non hai i permessi per accedere a questa chat.',
            messaggioErrore: 'Errore autorizzazione chat.'
        });
        if (!stanza) return;

        entraInStanzaChat(socket, stanza);
        try {
            // page: Pagina corrente di risultati o riferimento alla pagina in elaborazione.
            const page = await caricaStoricoChat(stanza.room);
            socket.emit('room_history', page.messages, { room: stanza.room, hasMore: page.hasMore });
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            console.error('Errore caricamento storico chat:', error.code || error.name);
            emettiErroreChat(socket, 'Impossibile caricare lo storico.');
        }
    });

    // Reagisce all’evento load_room_history aggiornando i dati o i controlli previsti.
    // Riceve: data (dati ricevuti); ack (callback di conferma Socket.IO).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    socket.on('load_room_history', async (data, ack) => {
        if (typeof ack !== 'function') return;
        if (!allowRoomEvent()) return ack({ errore: 'Troppe richieste chat. Attendi qualche secondo.' });
        // beforeId: Cursore identificato da un messaggio per leggere lo storico precedente.
        const beforeId = parsePositiveSafeId(data?.beforeId);
        if (!beforeId) return ack({ errore: 'Punto di partenza non valido.' });
        // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
        const stanza = await richiediStanzaAutorizzata(socket, utente, data?.room, { contesto: 'load_room_history' });
        if (!stanza) return ack({ errore: 'Impossibile caricare lo storico.' });
        try {
            return ack(await caricaStoricoChat(stanza.room, beforeId));
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            console.error('Errore caricamento messaggi precedenti:', error.code || error.name);
            return ack({ errore: 'Impossibile caricare i messaggi precedenti.' });
        }
    });

    // Controlla e salva il messaggio e comunica l’esito al mittente e alla stanza.
    // Riceve: data (dati ricevuti); ack (callback di conferma Socket.IO).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    socket.on('send_message', async (data, ack) => {
        // reject: Prepara il rifiuto dell’operazione e lo comunica al client attraverso il canale previsto.
        // Riceve: errore (messaggio di errore).
        const reject = errore => {
            if (typeof ack === 'function') return ack({ errore });
            emettiErroreChat(socket, errore);
        };
        if (!allowChatEvent()) {
            return reject('Troppi messaggi inviati. Attendi qualche secondo.');
        }

        // room: Identificativo della stanza su cui opera questo blocco.
        // contenuto: Testo del messaggio ricevuto dal client e sottoposto ai controlli previsti.
        // requestedFileUrl: Nome dell’allegato dichiarato dal client, da verificare prima del salvataggio.
        // requestedFileType: Tipo dell’allegato dichiarato dal client, da verificare prima del salvataggio.
        // uploadToken: Token di upload ricevuto dal client per autorizzare il riferimento al file.
        const {
            room,
            contenuto,
            file_url: requestedFileUrl,
            file_type: requestedFileType,
            upload_token: uploadToken
        } = data || {};
        // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
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

        // contenutoPulito: Risultato di cleanText. Converte e rifinisce il testo, controllando obbligatorietà e lunghezze;
        // distingue assenza valida e input non valido.
        const contenutoPulito = cleanText(contenuto, { max: 2000 });
        if (contenutoPulito === null) {
            return reject('Messaggio troppo lungo.');
        }

        // clientId: Identificatore del messaggio del client, usato per riconoscere gli invii ripetuti.
        const clientId = data?.client_id ?? null;
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (clientId !== null && (
            typeof clientId !== 'string' ||
            !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(clientId) ||
            requestedFileUrl || requestedFileType || uploadToken
        )) return reject('Identificativo messaggio non valido.');

        // fileUrl: Riferimento al file allegato da presentare o trasmettere.
        let fileUrl = null;
        // fileType: Tipo MIME dell’allegato usato per scegliere controlli e rappresentazione.
        let fileType = null;
        if (requestedFileUrl || requestedFileType || uploadToken) {
            // normalizedFileUrl: Risultato di cleanText. Converte e rifinisce il testo, controllando obbligatorietà e
            // lunghezze; distingue assenza valida e input non valido.
            const normalizedFileUrl = cleanText(requestedFileUrl, {
                min: 1,
                max: 255,
                required: true
            });
            // normalizedFileType: Risultato di cleanText. Converte e rifinisce il testo, controllando obbligatorietà e
            // lunghezze; distingue assenza valida e input non valido.
            const normalizedFileType = cleanText(requestedFileType, {
                min: 3,
                max: 100,
                required: true
            });
            // validUpload: Valore convertito o normalizzato prima del suo utilizzo.
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

            // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
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
                // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
                console.error('Errore salvataggio chat privata:', error.code || error.name);
                return reject('Impossibile salvare la conversazione.');
            }
        }

        // Inserisce i dati previsti nel database; i segnaposto ? ricevono i valori separati dai parametri.
        db.query('INSERT INTO messages (user_id, room, contenuto, file_url, file_type, client_id) VALUES (?,?,?,?,?,?)',
        // Riceve l’esito della query a callback e gestisce errore o righe restituite.
        // Riceve: err (errore intercettato); res (risposta HTTP).
        // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
        [userId, stanza.room, contenutoPulito, fileUrl, fileType, clientId], async (err, res) => {
            if (err) {
                if (clientId && err.code === 'ER_DUP_ENTRY') {
                    try {
                        // existing: Dati restituiti dal database al completamento della query.
                        // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
                        const [existing] = await queryAsync(
                            'SELECT id, room, contenuto FROM messages WHERE user_id = ? AND client_id = ?',
                            [userId, clientId]
                        );
                        if (existing?.room === stanza.room && existing.contenuto === contenutoPulito) {
                            if (typeof ack === 'function') ack({ ok: true, id: existing.id });
                            return;
                        }
                    } catch (lookupError) {
                        // lookupError: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
                        console.error('Errore verifica invio ripetuto:', lookupError.code || lookupError.name);
                    }
                }
                console.error('Errore salvataggio messaggio nel DB:', err.code || err.name);
                return reject('Errore durante l\'invio del messaggio.');
            }
            
            // msg: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
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
                // target: Risultato di getPrivateRoomPeer. Restituisce l’altro partecipante se l’utente appartiene alla stanza
                // privata indicata.
                const target = getPrivateRoomPeer(stanza.room, userId);
                if (target) io.to('user_' + target).emit('sveglia_nuova_chat', stanza.room);
            }
        });
    });

    // Reagisce all’evento sto_scrivendo aggiornando i dati o i controlli previsti.
    // Riceve: room (identificativo della stanza).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    socket.on('sto_scrivendo', async (room) => {
        // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
        const stanza = await richiediStanzaAutorizzata(socket, utente, room, {
            contesto: 'sto_scrivendo'
        });
        if (!stanza) return;

        socket.to(stanza.room).emit('utente_sta_scrivendo', { nome: utente.nome });
    });

    // Reagisce all’evento ho_smesso_di_scrivere aggiornando i dati o i controlli previsti.
    // Riceve: room (identificativo della stanza).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    socket.on('ho_smesso_di_scrivere', async (room) => {
        // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
        const stanza = await richiediStanzaAutorizzata(socket, utente, room, {
            contesto: 'ho_smesso_di_scrivere'
        });
        if (!stanza) return;

        socket.to(stanza.room).emit('utente_ha_smesso');
    });

    // Eliminazione messaggi e allegati da parte di admin/coach.
    // Verifica la richiesta di cancellazione del messaggio e ne comunica l’esito.
    // Riceve: msgId (id del messaggio).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    socket.on('delete_message', async (msgId) => {
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (utente.ruolo !== 'ADMIN' && utente.ruolo !== 'COACH') {
            return emettiErroreChat(socket, 'Solo admin e coach possono eliminare messaggi.');
        }

        // idMessaggio: Valore convertito o normalizzato prima del suo utilizzo.
        const idMessaggio = Number(msgId);
        if (!Number.isInteger(idMessaggio) || idMessaggio <= 0) {
            return emettiErroreChat(socket, 'Messaggio non valido.');
        }
        
        // Recupera l'eventuale allegato prima di eliminare il messaggio.
        // queryTrovaFile: Testo o valore iniziale utilizzato da questo blocco.
        const queryTrovaFile = "SELECT file_url, room FROM messages WHERE id = ?";
        
        // Riceve l’esito della query a callback e gestisce errore o righe restituite.
        // Riceve: err (errore intercettato); results (risultati dell’operazione).
        // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
        db.query(queryTrovaFile, [idMessaggio], async (err, results) => {
            if (err) {
                console.error("Errore ricerca file da eliminare:", err);
                return;
            }

            if (results.length > 0) {
                // nomeFile: Valore della proprietà results.0.file_url, conservato per le operazioni successive.
                const nomeFile = results[0].file_url;
                // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
                const stanza = results[0].room;
                try {
                    // puoGestireStanza: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
                    const puoGestireStanza = await utentePuoModerareStanza(utente, stanza);
                    if (!puoGestireStanza) {
                        return emettiErroreChat(socket, 'Non puoi eliminare messaggi da questa chat.');
                    }
                } catch (errAuth) {
                    // errAuth: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
                    console.error("Errore autorizzazione delete_message:", errAuth);
                    return emettiErroreChat(socket, 'Errore autorizzazione eliminazione.');
                }

                // Elimina definitivamente la riga dal database.
                // queryEliminaDB: Testo o valore iniziale utilizzato da questo blocco.
                const queryEliminaDB = "DELETE FROM messages WHERE id = ?";
                // Riceve l’esito della query a callback e gestisce errore o righe restituite.
                // Riceve: errDB (errore del database).
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

    // pendingCallOffers: Associa destinatari e tentativi di offerta per ignorare elaborazioni ormai superate.
    const pendingCallOffers = new Map();

    // Gestisce l’offerta SDP che avvia o rinegozia la chiamata.
    // Riceve: data (dati ricevuti); ack (callback di conferma Socket.IO).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    socket.on('webrtc_offer', async (data, ack) => {
        // reply: Invia l’esito al chiamante tramite la callback di conferma, se disponibile.
        // Riceve: result (esito dell’operazione).
        const reply = result => {
            if (typeof ack === 'function') ack(result);
            else if (result.errore) socket.emit('webrtc_error', { errore: result.errore });
        };
        if (!allowSignalingEvent()) {
            return reply({ errore: 'Troppi eventi di chiamata. Riprova tra poco.' });
        }

        // targetId: Identificativo dell’altro partecipante o destinatario.
        const targetId = parsePositiveSafeId(data?.targetId);
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (!targetId || !isValidSdp(data?.sdp, 'offer')) {
            return reply({ errore: 'Richiesta di chiamata non valida.' });
        }

        // offer: Risultato della chiamata Symbol, riutilizzato nelle istruzioni successive.
        const offer = Symbol();
        pendingCallOffers.set(targetId, offer);
        try {
            if (!await utentePuoChiamare(utente, targetId)) {
                return reply({ errore: 'Destinatario non autorizzato.' });
            }
            if (!socket.connected || pendingCallOffers.get(targetId) !== offer) {
                return reply({ errore: 'Chiamata annullata.' });
            }

            // call: Risultato di start. Registra una chiamata tra due utenti liberi; restituisce la registrazione oppure null.
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
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            console.error('Errore autorizzazione offerta WebRTC:', error);
            reply({ errore: 'Impossibile avviare la chiamata.' });
        } finally {
            if (pendingCallOffers.get(targetId) === offer) pendingCallOffers.delete(targetId);
        }
    });

    // Gestisce la risposta SDP necessaria a completare la negoziazione.
    // Riceve: data (dati ricevuti).
    socket.on('webrtc_answer', (data) => {
        if (!allowSignalingEvent()) return;
        // targetId: Identificativo dell’altro partecipante o destinatario.
        const targetId = parsePositiveSafeId(data?.targetId);
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (!targetId || !isValidSdp(data?.sdp, 'answer')) {
            return socket.emit('webrtc_error', { errore: 'Risposta di chiamata non valida.' });
        }
        // call: Risultato di touch. Aggiorna l’istante di attività della chiamata trovata e ne restituisce la
        // registrazione.
        const call = chiamateAttive.touch(userId, targetId);
        if (!call) return socket.emit('webrtc_error', { errore: 'Chiamata non più attiva.' });

        io.to('user_' + targetId).emit('webrtc_answer', {
            sdp: data.sdp,
            answererId: utente.id
        });
    });

    // Gestisce il candidato ICE che descrive un possibile percorso di rete.
    // Riceve: data (dati ricevuti).
    socket.on('webrtc_ice_candidate', (data) => {
        if (!allowSignalingEvent()) return;
        // targetId: Identificativo dell’altro partecipante o destinatario.
        const targetId = parsePositiveSafeId(data?.targetId);
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (!targetId || !isValidIceCandidate(data?.candidate)) return;
        // call: Risultato di touch. Aggiorna l’istante di attività della chiamata trovata e ne restituisce la
        // registrazione.
        const call = chiamateAttive.touch(userId, targetId);
        if (!call) return;

        io.to('user_' + targetId).emit('webrtc_ice_candidate', {
            candidate: data.candidate,
            senderId: utente.id
        });
    });

    // Gestisce la chiusura della chiamata comunicata dall’altro partecipante.
    // Riceve: data (dati ricevuti).
    socket.on('webrtc_end_call', (data) => {
        // targetId: Identificativo dell’altro partecipante o destinatario.
        const targetId = parsePositiveSafeId(data?.targetId);
        if (!targetId) return;
        pendingCallOffers.delete(targetId);

        if (!chiamateAttive.end(userId, targetId)) return;
        io.to('user_' + targetId).emit('webrtc_end_call', { senderId: userId });
    });

    // Sincronizza lo stato di attivazione del video dell’altro partecipante.
    // Riceve: data (dati ricevuti).
    socket.on('webrtc_toggle_video', (data) => {
        if (!allowSignalingEvent()) return;
        // targetId: Identificativo dell’altro partecipante o destinatario.
        const targetId = parsePositiveSafeId(data?.targetId);
        if (!targetId || typeof data?.isVideoOn !== 'boolean') return;
        // call: Risultato di touch. Aggiorna l’istante di attività della chiamata trovata e ne restituisce la
        // registrazione.
        const call = chiamateAttive.touch(userId, targetId);
        if (!call) return;

        io.to('user_' + targetId).emit('webrtc_toggle_video', {
            isVideoOn: data.isVideoOn,
            senderId: userId
        });
    });

    // Sincronizza lo stato del microfono e dell’ascolto dell’altro partecipante.
    // Riceve: data (dati ricevuti).
    socket.on('webrtc_audio_state', (data) => {
        if (!allowSignalingEvent()) return;
        // targetId: Identificativo dell’altro partecipante o destinatario.
        const targetId = parsePositiveSafeId(data?.targetId);
        if (!targetId || typeof data.micOn !== 'boolean' || typeof data.listening !== 'boolean') return;
        if (!chiamateAttive.touch(userId, targetId)) return;
        io.to('user_' + targetId).emit('webrtc_audio_state', {
            senderId: userId,
            micOn: data.micOn,
            listening: data.listening
        });
    });

    // Gestisce la disconnessione e aggiorna o libera lo stato collegato.
    socket.on('disconnect', () => {
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: otherUserId (id dell’altro partecipante da avvisare).
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

// GIORNI_SCADENZA: Impostazione letta dalle variabili di ambiente del processo.
const GIORNI_SCADENZA = Number(process.env.MESSAGE_RETENTION_DAYS || 15);
if (!Number.isInteger(GIORNI_SCADENZA) || GIORNI_SCADENZA < 1 || GIORNI_SCADENZA > 3650) {
    throw new Error('MESSAGE_RETENTION_DAYS deve essere un intero tra 1 e 3650.');
}

// pulisciVecchiMessaggi: Elimina i messaggi oltre il periodo di conservazione e richiede la pulizia dei file
// diventati inutilizzati.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function pulisciVecchiMessaggi() {
    try {
        // cutoff: Istante limite prima del quale le registrazioni sono considerate scadute.
        const cutoff = new Date(Date.now() - GIORNI_SCADENZA * 86400000);
        // Ripete il blocco finché la condizione di controllo lo permette.
        while (true) {
            // rows: Righe restituite dalla query o dal caricamento corrente.
            // Legge i dati necessari dal database; i segnaposto ? ricevono i valori separati dai parametri.
            const rows = await queryAsync(
                'SELECT id, file_url FROM messages WHERE data_invio < ? ORDER BY data_invio, id LIMIT 250',
                [cutoff]
            );
            if (rows.length === 0) return;
            // Elimina i record individuati dalle condizioni della query; i segnaposto ? ricevono i valori separati dai
            // parametri.
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: row (riga del risultato).
            await queryAsync('DELETE FROM messages WHERE id IN (?) AND data_invio < ?', [rows.map(row => row.id), cutoff]);
            // files: Insieme che conserva valori senza duplicati.
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: row (riga del risultato).
            const files = new Set(rows.map(row => row.file_url).filter(Boolean));
            // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
            // filename: Riferimento o risultato da valorizzare durante l’operazione.
            for (const filename of files) await removeUploadedFileIfUnused(filename, db);
        }
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error('Errore manutenzione messaggi:', error.code || error.name);
    }
}

if (process.env.NODE_ENV !== 'test') {
    pulisciVecchiMessaggi();
    setInterval(pulisciVecchiMessaggi, 24 * 60 * 60 * 1000);
}

// Middleware Express: controlla o prepara la richiesta prima dei gestori successivi.
// Riceve: error (errore intercettato); req (richiesta HTTP); res (risposta HTTP); next (passaggio al middleware
// successivo).
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json({ errore: 'Corpo JSON non valido.' });
    }
    console.error('Errore HTTP non gestito:', error.code || error.message);
    res.status(500).json({ errore: 'Errore interno del server.' });
});

// startListening: Avvia l’ascolto HTTP sulla porta configurata dopo i controlli iniziali.
function startListening() {
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    server.listen(PORT, () => {
        console.info(`Server attivo sulla porta ${server.address().port}`);
    });
}

db.checkConnection()
    // Elabora il risultato quando la Promise precedente si completa con successo.
    .then(() => {
        console.info('Connessione al database verificata.');
        startListening();
    })
    // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
    // Riceve: error (errore intercettato).
    .catch((error) => {
        console.error('Impossibile avviare il server: verifica connessione e migrazioni MySQL.');
        console.error(error.code || 'DB_ERROR', error.message);
        process.exit(1);
    });
