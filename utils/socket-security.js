// Valida dati di chat e signaling WebRTC; mantiene in memoria chiamate attive e limiti degli eventi.
// CallRegistry: raggruppa stato e metodi del registro; ogni istanza mantiene i propri dati.
class CallRegistry {
    // constructor: Inizializza lo stato della nuova istanza con i parametri e i valori predefiniti previsti.
    // Riceve: ttlMs (durata di validità in millisecondi).
    // function Object() { [native code] }
    constructor({ ttlMs = 2 * 60 * 60 * 1000 } = {}) {
        this.calls = new Map();
        this.ttlMs = ttlMs;
    }

    // key: Costruisce una chiave ordinata per la coppia di utenti oppure restituisce null per identificativi non
    // validi.
    // Riceve: userId (id dell’utente); targetId (id del destinatario).
    key(userId, targetId) {
        // firstId: Primo identificativo validato della coppia.
        const firstId = parsePositiveSafeId(userId);
        // secondId: Secondo identificativo validato della coppia.
        const secondId = parsePositiveSafeId(targetId);
        if (!firstId || !secondId || firstId === secondId) return null;

        // Confronta due elementi per stabilirne l’ordine nella raccolta.
        // Riceve: a (primo elemento); b (secondo elemento).
        return [firstId, secondId].sort((a, b) => a - b).join(':');
    }

    // prune: Rimuove dal registro delle chiamate le voci non aggiornate entro la durata prevista.
    prune() {
        // cutoff: Istante limite prima del quale le registrazioni sono considerate scadute.
        const cutoff = Date.now() - this.ttlMs;
        // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
        // key: Riferimento o risultato da valorizzare durante l’operazione.
        // call: Riferimento o risultato da valorizzare durante l’operazione.
        for (const [key, call] of this.calls) {
            if (call.updatedAt < cutoff) this.calls.delete(key);
        }
    }

    // get: Restituisce la chiamata registrata per la coppia oppure un valore di assenza.
    // Riceve: userId (id dell’utente); targetId (id del destinatario).
    get(userId, targetId) {
        // key: Risultato di key. Costruisce una chiave ordinata per la coppia di utenti oppure restituisce null per
        // identificativi non validi.
        const key = this.key(userId, targetId);
        return key ? this.calls.get(key) : null;
    }

    // hasOtherCall: Indica se l’utente è già coinvolto in una chiamata diversa da quella consentita.
    // Riceve: userId (id dell’utente); allowedKey (chiave della chiamata consentita).
    hasOtherCall(userId, allowedKey) {
        // currentUserId: Identificativo validato dell’utente corrente.
        const currentUserId = parsePositiveSafeId(userId);
        if (!currentUserId) return false;

        // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
        // key: Riferimento o risultato da valorizzare durante l’operazione.
        // call: Riferimento o risultato da valorizzare durante l’operazione.
        for (const [key, call] of this.calls) {
            if (key !== allowedKey && call.participants.has(currentUserId)) return true;
        }
        return false;
    }

    // start: Registra una chiamata tra due utenti liberi; restituisce la registrazione oppure null.
    // Riceve: userId (id dell’utente); targetId (id del destinatario).
    start(userId, targetId) {
        this.prune();
        // key: Risultato di key. Costruisce una chiave ordinata per la coppia di utenti oppure restituisce null per
        // identificativi non validi.
        const key = this.key(userId, targetId);
        if (!key) return null;
        // firstId: Primo identificativo validato della coppia.
        const firstId = parsePositiveSafeId(userId);
        // secondId: Secondo identificativo validato della coppia.
        const secondId = parsePositiveSafeId(targetId);

        if (this.hasOtherCall(userId, key) || this.hasOtherCall(targetId, key)) return null;

        // call: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const call = {
            participants: new Set([firstId, secondId]),
            updatedAt: Date.now()
        };
        this.calls.set(key, call);
        return call;
    }

    // touch: Aggiorna l’istante di attività della chiamata trovata e ne restituisce la registrazione.
    // Riceve: userId (id dell’utente); targetId (id del destinatario).
    touch(userId, targetId) {
        // call: Valore recuperato dalla raccolta indicizzata mediante la chiave.
        const call = this.get(userId, targetId);
        if (call) call.updatedAt = Date.now();
        return call;
    }

    // end: Rimuove la chiamata identificata dalla coppia e restituisce se era presente.
    // Riceve: userId (id dell’utente); targetId (id del destinatario).
    end(userId, targetId) {
        // key: Risultato di key. Costruisce una chiave ordinata per la coppia di utenti oppure restituisce null per
        // identificativi non validi.
        const key = this.key(userId, targetId);
        if (!key) return false;
        if (!this.calls.has(key)) return false;
        this.calls.delete(key);
        return true;
    }

    // removeUser: Rimuove le chiamate dell’utente e restituisce gli identificativi degli altri partecipanti da
    // avvisare.
    // Riceve: userId (id dell’utente).
    removeUser(userId) {
        // endedCalls: Elenco dei valori che questo blocco deve confrontare, mostrare o elaborare.
        const endedCalls = [];
        // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
        // key: Riferimento o risultato da valorizzare durante l’operazione.
        // call: Riferimento o risultato da valorizzare durante l’operazione.
        for (const [key, call] of this.calls) {
            if (!call.participants.has(Number(userId))) continue;
            // otherUserId: Identificativo dell’altro partecipante da avvisare.
            // Restituisce il criterio per individuare il primo elemento corrispondente.
            // Riceve: id (identificativo dell’elemento).
            const otherUserId = [...call.participants].find(id => id !== Number(userId));
            this.calls.delete(key);
            endedCalls.push(otherUserId);
        }
        return endedCalls.filter(Boolean);
    }
}

// parsePositiveSafeId: Converte un valore in intero positivo rappresentabile senza perdita di precisione oppure
// restituisce null.
// Riceve: value (valore da elaborare).
function parsePositiveSafeId(value) {
    // id: Valore convertito o normalizzato prima del suo utilizzo.
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// normalizeChatRoom: Riconosce e normalizza i formati di stanza consentiti, verificando anche gli id dei
// partecipanti privati.
// Riceve: value (valore da elaborare).
function normalizeChatRoom(value) {
    if (typeof value !== 'string') return null;

    // room: Identificativo della stanza su cui opera questo blocco.
    const room = value.trim();
    if (!room || room.length > 50) return null;
    if (room === 'general') return { room, type: 'general' };

    // privateMatch: Risultato della chiamata .exec, riutilizzato nelle istruzioni successive.
    const privateMatch = /^private_(\d+)_(\d+)$/.exec(room);
    if (privateMatch) {
        // firstId: Primo identificativo validato della coppia.
        const firstId = parsePositiveSafeId(privateMatch[1]);
        // secondId: Secondo identificativo validato della coppia.
        const secondId = parsePositiveSafeId(privateMatch[2]);
        if (!firstId || !secondId || firstId === secondId) return null;

        // normalizedRoom: Nome canonico della stanza ottenuto ordinando gli identificativi dei partecipanti.
        const normalizedRoom = `private_${Math.min(firstId, secondId)}_${Math.max(firstId, secondId)}`;
        if (room !== normalizedRoom) return null;

        return {
            room,
            type: 'private',
            userIds: [firstId, secondId]
        };
    }

    // courseMatch: Risultato della chiamata .exec, riutilizzato nelle istruzioni successive.
    const courseMatch = /^corso_(\d+)$/.exec(room);
    if (courseMatch) {
        // id: Valore convertito o normalizzato prima del suo utilizzo.
        const id = parsePositiveSafeId(courseMatch[1]);
        return id ? { room, type: 'corso', id } : null;
    }

    // raceMatch: Risultato della chiamata .exec, riutilizzato nelle istruzioni successive.
    const raceMatch = /^gara_(\d+)$/.exec(room);
    if (raceMatch) {
        // id: Valore convertito o normalizzato prima del suo utilizzo.
        const id = parsePositiveSafeId(raceMatch[1]);
        return id ? { room, type: 'gara', id } : null;
    }

    return null;
}

// getPrivateRoomPeer: Restituisce l’altro partecipante se l’utente appartiene alla stanza privata indicata.
// Riceve: room (identificativo della stanza); userId (id dell’utente).
function getPrivateRoomPeer(room, userId) {
    // chatRoom: Risultato di normalizeChatRoom. Riconosce e normalizza i formati di stanza consentiti, verificando
    // anche gli id dei partecipanti privati.
    const chatRoom = normalizeChatRoom(room);
    // currentUserId: Identificativo validato dell’utente corrente.
    const currentUserId = parsePositiveSafeId(userId);
    if (!chatRoom || chatRoom.type !== 'private' || !currentUserId) return null;
    if (!chatRoom.userIds.includes(currentUserId)) return null;

    // Restituisce il criterio per individuare il primo elemento corrispondente.
    // Riceve: id (identificativo dell’elemento).
    return chatRoom.userIds.find(id => id !== currentUserId) || null;
}

// isValidSdp: Controlla tipo, struttura e lunghezza della descrizione SDP usata nel signaling WebRTC.
// Riceve: sdp (descrizione di sessione WebRTC); expectedType (tipo SDP atteso).
function isValidSdp(sdp, expectedType) {
    return Boolean(
        sdp &&
        typeof sdp === 'object' &&
        sdp.type === expectedType &&
        typeof sdp.sdp === 'string' &&
        sdp.sdp.length > 0 &&
        sdp.sdp.length <= 200000
    );
}

// isValidIceCandidate: Controlla struttura e dimensione del candidato ICE ricevuto prima dell’inoltro.
// Riceve: candidate (candidato ICE).
function isValidIceCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') return false;
    if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 20000) return false;
    try {
        return JSON.stringify(candidate).length <= 30000;
    } catch {
        return false;
    }
}

// createRateLimiter: Restituisce una funzione che conta gli eventi nella finestra temporale e indica se il limite
// è rispettato.
// Riceve: limit (numero massimo di eventi); windowMs (durata della finestra in millisecondi).
function createRateLimiter(limit, windowMs) {
    // windowStart: Istante iniziale della finestra usata dal limite di frequenza.
    let windowStart = Date.now();
    // count: Contatore degli elementi o eventi elaborati dal blocco.
    let count = 0;
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    return () => {
        // now: Istante attuale in millisecondi usato per scadenze e durate.
        const now = Date.now();
        if (now - windowStart >= windowMs) {
            windowStart = now;
            count = 0;
        }
        count += 1;
        return count <= limit;
    };
}

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = {
    CallRegistry,
    createRateLimiter,
    getPrivateRoomPeer,
    isValidIceCandidate,
    isValidSdp,
    normalizeChatRoom,
    parsePositiveSafeId
};
