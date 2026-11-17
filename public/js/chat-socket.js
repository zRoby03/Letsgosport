// Frontend in tempo reale: riceve eventi Socket.IO e sincronizza stanze, storico, presenza e notifiche.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Socket.IO gestisce eventi e stanze; il trasporto sottostante può usare WebSocket o polling HTTP secondo la
// configurazione.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
window.app = window.app || {};

// Collega i controlli quando gli elementi HTML sono disponibili nel DOM.
document.addEventListener('DOMContentLoaded', () => {
    // btnChat: Elemento DOM btn-chat: Pulsante del controllo.
    const btnChat = document.getElementById('btn-chat');
    if(btnChat) {
        // Esegue l’azione del controllo quando viene premuto. Mostra o nasconde l’indicatore di novità sulla voce di
        // navigazione della chat.
        btnChat.addEventListener('click', () => impostaBadgeNavChat(false));
    }
});

// creaSocketDisabilitato: Fornisce un oggetto sostitutivo quando Socket.IO non è disponibile, evitando chiamate a
// metodi mancanti.
function creaSocketDisabilitato() {
    // avvisoMostrato: Evita di mostrare più volte l’avviso di backend assente.
    let avvisoMostrato = false;
    // socketDisabilitato: Oggetto sostitutivo con i metodi attesi quando il client Socket.IO non è disponibile.
    const socketDisabilitato = {
        connected: false,
        disconnected: true,
        // on: Fornisce il metodo compatibile con i gestori Socket.IO nell’oggetto sostitutivo.
        on() { return socketDisabilitato; },
        // emit: Fornisce il metodo compatibile con l’invio Socket.IO nell’oggetto sostitutivo.
        emit() { return socketDisabilitato; },
        // connect: Aggiorna l’oggetto sostitutivo quando viene richiesto il collegamento, senza aprire un socket reale.
        connect() {
            if (!avvisoMostrato) {
                avvisoMostrato = true;
                window.app.mostraNotifica?.(
                    'Chat non disponibile: avvia il backend con npm start.',
                    'error'
                );
            }
            return socketDisabilitato;
        }
    };
    return socketDisabilitato;
}

// socket: Connessione Socket.IO condivisa con il client o con gli altri moduli del frontend.
var socket = typeof window.io === 'function'
    ? window.io({ autoConnect: false })
    : creaSocketDisabilitato();
window.socket = socket;
window.stanzaAttuale = 'general';

// mioRuoloChat: Ruolo dell’utente usato per adattare la rappresentazione della chat.
let mioRuoloChat = 'PARTNER'; 
// notificheDesktopAttive: Preferenza locale che abilita la richiesta di notifiche del browser.
let notificheDesktopAttive = localStorage.getItem('notifiche_desktop_attive') === 'true';
// radarUtentiOnline: Mappa della presenza e dello stato personale degli utenti online.
let radarUtentiOnline = new Map(); 
// mioStatoAttuale: Stato personale ripristinato dalle preferenze locali del browser.
let mioStatoAttuale = localStorage.getItem('mioStatoDND') || 'ONLINE'; 

// aggiornaRadarChat: Richiede l’aggiornamento visivo degli indicatori di presenza.
function aggiornaRadarChat() {
    app.aggiornaGraficaRadar?.();
}

// impostaBadgeNavChat: Mostra o nasconde l’indicatore di novità sulla voce di navigazione della chat.
// Riceve: visibile (visibilità richiesta).
function impostaBadgeNavChat(visibile) {
    // navBadge: Elemento DOM badge-nav-chat: Etichetta o indicatore dell’interfaccia.
    const navBadge = document.getElementById('badge-nav-chat');
    if (!navBadge) return;
    navBadge.hidden = !visibile;
    navBadge.style.display = '';
}

// impostaBadgeStanza: Aggiorna il badge dei messaggi non letti della stanza indicata.
// Riceve: roomId (id della stanza); visibile (visibilità richiesta).
function impostaBadgeStanza(roomId, visibile) {
    // badge: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
    const badge = document.getElementById(`badge-${roomId}`);
    if (badge) badge.hidden = !visibile;
}

// chatAttualmenteChiusa: Indica se l’utente sta visualizzando una sezione diversa dalla chat.
function chatAttualmenteChiusa() {
    // paginaChat: Elemento DOM pagina-chat: Contenitore dell’interfaccia.
    const paginaChat = document.getElementById('pagina-chat');
    return Boolean(paginaChat && paginaChat.classList.contains('hidden'));
}

// segnaStanzaLetta: Memorizza il riferimento temporale usato per riconoscere i messaggi già letti.
// Riceve: roomId (id della stanza); timestamp (riferimento temporale).
function segnaStanzaLetta(roomId, timestamp = Date.now()) {
    if (roomId) localStorage.setItem('chat_read_' + roomId, timestamp + 5000);
}

// Gestisce il fallimento del collegamento Socket.IO.
// Riceve: err (errore intercettato).
socket.on('connect_error', (err) => {
    console.error("Errore di connessione Socket:", err.message);
    app.aggiornaStatoConnessioneChat?.('error', 'Errore connessione');
});
// Gestisce la disconnessione e aggiorna o libera lo stato collegato.
// Riceve: reason (motivo della disconnessione).
socket.on('disconnect', (reason) => {
    console.warn("Socket disconnesso:", reason);
    app.aggiornaStatoConnessioneChat?.('offline', 'Offline');
    if (reason === 'io server disconnect' && typeof app.mostraNotifica === 'function') {
        app.mostraNotifica("Sessione chat scaduta. Ricarica la pagina o accedi di nuovo.", "error");
    }
});
// Il collegamento Socket.IO è pronto: sincronizza lo stato del client.
socket.on('connect', () => {
    app.aggiornaStatoConnessioneChat?.('online', 'Online');
    socket.emit('join_room', window.stanzaAttuale);
    socket.emit('cambia_stato', mioStatoAttuale); 
});
// Reagisce all’evento chat_error aggiornando i dati o i controlli previsti.
// Riceve: dati (dati dell’evento).
socket.on('chat_error', (dati) => {
    if(typeof app.mostraNotifica === 'function') app.mostraNotifica(dati.errore, "error");
});

// Reagisce all’evento utenti_online_iniziali aggiornando i dati o i controlli previsti.
// Riceve: mappaStati (stati personali indicizzati per utente).
socket.on('utenti_online_iniziali', (mappaStati) => {
    radarUtentiOnline = new Map();
    // Scorre i nomi delle proprietà dell’oggetto.
    // id: Riferimento o risultato da valorizzare durante l’operazione.
    for (let id in mappaStati) radarUtentiOnline.set(Number(id), mappaStati[id]);
    aggiornaRadarChat();
});
// Reagisce all’evento utente_connesso aggiornando i dati o i controlli previsti.
// Riceve: dati (dati dell’evento).
socket.on('utente_connesso', (dati) => {
    radarUtentiOnline.set(Number(dati.id), dati.stato);
    aggiornaRadarChat();
});
// Reagisce all’evento utente_disconnesso aggiornando i dati o i controlli previsti.
// Riceve: payload (dati dell’operazione).
socket.on('utente_disconnesso', (payload) => {
    // userId: Identificativo dell’utente interessato dall’operazione.
    const userId = typeof payload === 'object' ? payload.id : payload;
    radarUtentiOnline.delete(Number(userId));
    aggiornaRadarChat();
});
// Sincronizza lo stato personale o la presenza comunicati dal server.
// Riceve: dati (dati dell’evento).
socket.on('stato_aggiornato', (dati) => {
    radarUtentiOnline.set(Number(dati.id), dati.stato);
    aggiornaRadarChat();
    if (typeof app.caricaStanzeChat === 'function') app.caricaStanzeChat(); 
});
// Riceve il messaggio in tempo reale e aggiorna conversazione e indicatori.
// Riceve: datiMessaggio (dati del messaggio ricevuto).
socket.on('receive_message', (datiMessaggio) => {
    app.aggiornaAnteprimaStanzaMessaggio?.(datiMessaggio);
    if (datiMessaggio.room === window.stanzaAttuale) {
        if(typeof app.stampaFumetto === 'function') app.stampaFumetto(datiMessaggio);
        segnaStanzaLetta(window.stanzaAttuale, new Date(datiMessaggio.data_invio).getTime());
    } else {
        if (datiMessaggio.user_id !== window.app.mioId) {
            impostaBadgeStanza(datiMessaggio.room, true);
        } else {
            segnaStanzaLetta(datiMessaggio.room, new Date(datiMessaggio.data_invio).getTime());
        }
    }
    if (typeof app.spostaStanzaInCima === 'function') app.spostaStanzaInCima(datiMessaggio.room);

    if (datiMessaggio.user_id !== window.app.mioId && (chatAttualmenteChiusa() || datiMessaggio.room !== window.stanzaAttuale)) {
        impostaBadgeNavChat(true);
        if (typeof app.lanciaNotificaPush === 'function') app.lanciaNotificaPush();
    }
});
// aggiungiCaricamentoStorico: Aggiunge il controllo per richiedere la pagina precedente della conversazione.
// Riceve: contenitore (contenitore dei messaggi); room (identificativo della stanza); beforeId (id del messaggio
// usato come cursore).
function aggiungiCaricamentoStorico(contenitore, room, beforeId) {
    // button: Elemento DOM creato per comporre questa parte dell’interfaccia.
    const button = app.creaElemento('button', {
        className: 'chat-load-history',
        text: 'Carica messaggi precedenti',
        attrs: { type: 'button' }
    });
    // Esegue l’azione del controllo quando viene premuto.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    button.addEventListener('click', async () => {
        if (!socket.connected || window.stanzaAttuale !== room) return;
        button.disabled = true;
        try {
            // page: Pagina corrente di risultati o riferimento alla pagina in elaborazione.
            const page = await socket.timeout(7000).emitWithAck('load_room_history', { room, beforeId });
            if (!button.isConnected || window.stanzaAttuale !== room) return;
            if (page?.errore || !Array.isArray(page?.messages)) throw new Error('Storico non disponibile');
            // previousHeight: Altezza del contenuto prima dell’inserimento dei messaggi precedenti.
            const previousHeight = contenitore.scrollHeight;
            // previousTop: Posizione di scorrimento da compensare dopo il caricamento dello storico.
            const previousTop = contenitore.scrollTop;
            // fragment: Frammento DOM che raccoglie i nodi prima del loro inserimento nel documento.
            const fragment = document.createDocumentFragment();
            // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
            // message: Messaggio di stato o contenuto da rappresentare.
            for (const message of page.messages) app.stampaFumetto(message, { skipScroll: true, target: fragment });
            button.after(fragment);
            if (page.hasMore && page.messages.length) beforeId = page.messages[0].id;
            else button.remove();
            contenitore.scrollTop = previousTop + contenitore.scrollHeight - previousHeight;
        } catch {
            app.mostraNotifica?.('Impossibile caricare i messaggi precedenti. Riprova.', 'warning');
        } finally {
            button.disabled = false;
        }
    });
    contenitore.prepend(button);
}

// Reagisce all’evento room_history aggiornando i dati o i controlli previsti.
// Riceve: storicoMessaggi (messaggi della pagina ricevuta); page (metadati della pagina ricevuta).
socket.on('room_history', (storicoMessaggi, page = {}) => {
    if (page.room && page.room !== window.stanzaAttuale) return;
    // contenitore: Elemento DOM contenitore-messaggi: Messaggi della chat.
    const contenitore = document.getElementById('contenitore-messaggi');
    if (!contenitore) return;
    contenitore.replaceChildren();

    if (!Array.isArray(storicoMessaggi) || storicoMessaggi.length === 0) {
        // statoVuoto: Risultato di creaStatoVuotoChat. Prepara il messaggio mostrato quando la conversazione non contiene
        // ancora messaggi.
        const statoVuoto = app.creaStatoVuotoChat?.();
        contenitore.appendChild(statoVuoto || app.creaElemento('p', {
            className: 'chat-list-state',
            text: 'Ancora nessun messaggio. Scrivi tu per primo.'
        }));
        app.scrollaChatInFondo?.(true);
        return;
    }
    
    // orarioPiuRecente: Valore numerico o contatore iniziale utilizzato da questo blocco.
    let orarioPiuRecente = 0;
    // Applica l’operazione del blocco a ciascun elemento della raccolta.
    // Riceve: msg (messaggio corrente).
    storicoMessaggi.forEach(msg => {
        if(typeof app.stampaFumetto === 'function') app.stampaFumetto(msg, { skipScroll: true });
        // tempoMsg: Risultato della chiamata .getTime, riutilizzato nelle istruzioni successive.
        const tempoMsg = new Date(msg.data_invio).getTime();
        if (tempoMsg > orarioPiuRecente) orarioPiuRecente = tempoMsg;
    });
    if (page.hasMore) aggiungiCaricamentoStorico(contenitore, page.room, storicoMessaggi[0].id);
    if (orarioPiuRecente > 0) segnaStanzaLetta(window.stanzaAttuale, orarioPiuRecente);
    app.scrollaChatInFondo?.(true);
});
// Rimuove dall’interfaccia il messaggio cancellato.
// Riceve: msgId (id del messaggio).
socket.on('message_deleted', (msgId) => {
    // fumetto: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
    const fumetto = document.getElementById(`msg-${msgId}`);
    if (fumetto) {
        fumetto.style.opacity = '0';
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        setTimeout(() => fumetto.remove(), 300);
    }
});
// Reagisce all’evento sveglia_nuova_chat aggiornando i dati o i controlli previsti.
// Riceve: room_id (identificativo della stanza).
socket.on('sveglia_nuova_chat', (room_id) => {
    // roomId: Identificativo della stanza a cui appartiene l’operazione.
    const roomId = typeof room_id === 'string' ? room_id : '';
    if (!roomId) return;

    // stanzaDiversa: Risultato del calcolo o del controllo applicato ai valori del blocco.
    const stanzaDiversa = roomId !== window.stanzaAttuale;

    if (chatAttualmenteChiusa() || stanzaDiversa) {
        impostaBadgeNavChat(true);
        if (typeof app.lanciaNotificaPush === 'function') app.lanciaNotificaPush();
    }

    impostaBadgeStanza(roomId, true);

    if (!document.getElementById(`nav-room-${roomId}`)) {
        if (typeof app.caricaStanzeChat === 'function') app.caricaStanzeChat();
    }
});
// Reagisce all’evento utente_sta_scrivendo aggiornando i dati o i controlli previsti.
// Riceve: data (dati ricevuti).
socket.on('utente_sta_scrivendo', (data) => {
    // indicatore: Elemento DOM indicatore-scrittura: Contenitore dell’interfaccia.
    const indicatore = document.getElementById('indicatore-scrittura');
    if (indicatore) { indicatore.innerText = `✍️ ${data.nome} sta scrivendo...`; indicatore.style.display = 'block'; }
});
// Reagisce all’evento utente_ha_smesso aggiornando i dati o i controlli previsti.
socket.on('utente_ha_smesso', () => {
    // indicatore: Elemento DOM indicatore-scrittura: Contenitore dell’interfaccia.
    const indicatore = document.getElementById('indicatore-scrittura');
    if (indicatore) { indicatore.style.display = 'none'; indicatore.innerText = ''; }
});

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {
    // chatNotificheSupportate: Indica se il browser espone le notifiche desktop utilizzate dalla chat.
    chatNotificheSupportate() {
        return typeof window.Notification === 'function';
    },

    // isSocketChatPronto: Controlla che la connessione Socket.IO della chat sia pronta per l’invio.
    isSocketChatPronto() {
        return typeof socket !== 'undefined' && socket.connected;
    },

    // nomeStanzaChatAttiva: Ricava il nome leggibile della stanza chat attualmente selezionata.
    nomeStanzaChatAttiva() {
        // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
        const stanza = this.getStanzaChat?.(window.stanzaAttuale);
        if (window.stanzaAttuale === 'general') return 'Piazza principale';
        if (stanza?.nome) return stanza.nome;

        // titolo: Testo letto dall’elemento DOM e rifinito per questo utilizzo.
        const titolo = document.getElementById('titolo-chat-attiva')?.textContent?.trim();
        return titolo || 'questa chat';
    },

    // aggiornaStatoConnessioneChat: Aggiorna etichetta e controlli della chat in base allo stato della connessione.
    // Riceve: stato (stato da rappresentare o comunicare); testo (testo da visualizzare).
    aggiornaStatoConnessioneChat(stato = 'offline', testo) {
        // status: Elemento DOM chat-connection-status: Etichetta o indicatore dell’interfaccia.
        const status = document.getElementById('chat-connection-status');
        // labels: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const labels = {
            online: 'Online',
            connecting: 'Connessione...',
            offline: 'Offline',
            error: 'Errore'
        };
        // statoPulito: Valore scelto tra i due rami in base alla condizione indicata.
        const statoPulito = labels[stato] ? stato : 'offline';

        if (status) {
            status.textContent = testo || labels[statoPulito];
            status.className = `chat-connection-status is-${statoPulito}`;
        }

        document.body.classList.toggle('chat-is-online', statoPulito === 'online');
        document.body.classList.toggle('chat-is-offline', statoPulito !== 'online');
        this.aggiornaComposerChat?.();
    },

    // aggiornaComposerChat: Abilita o blocca i controlli di composizione in base a stanza e connessione.
    aggiornaComposerChat() {
        // composer: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const composer = document.querySelector('#pagina-chat .chat-composer');
        // input: Elemento DOM input-messaggio: Campo di input.
        const input = document.getElementById('input-messaggio');
        // attachButton: Elemento DOM btn-allega-chat: Allega un file.
        const attachButton = document.getElementById('btn-allega-chat');
        // recordButton: Elemento DOM btn-registra-vocale: Tieni premuto per registrare.
        const recordButton = document.getElementById('btn-registra-vocale');
        // sendButton: Elemento DOM btn-invia-chat: Invia.
        const sendButton = document.getElementById('btn-invia-chat');
        // testo: Testo normalizzato o preparato per la rappresentazione corrente.
        const testo = input?.value.trim() || '';
        // connesso: Risultato di isSocketChatPronto. Controlla che la connessione Socket.IO della chat sia pronta per
        // l’invio.
        const connesso = this.isSocketChatPronto();
        // bloccato: Indica se composizione e invio devono essere disabilitati nello stato attuale.
        const bloccato = !window.app.mioId || !connesso;
        if (bloccato && this.registrazioneVocale && !this.registrazioneVocale.finishing) {
            this.fermaRegistrazioneVocale?.(true);
        }
        const voceOccupata = Boolean(this.registrazioneVocale);

        composer?.classList.toggle('is-disabled', bloccato);
        composer?.classList.toggle('is-ready', !bloccato);

        if (input) {
            input.disabled = bloccato || voceOccupata;
            input.placeholder = bloccato
                ? 'Connessione chat in corso...'
                : `Scrivi in ${this.nomeStanzaChatAttiva()}...`;
        }

        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: button (pulsante da configurare).
        [attachButton, recordButton].forEach(button => {
            if (button) button.disabled = bloccato || (button === recordButton
                ? Boolean(this.registrazioneVocale?.finishing) : voceOccupata);
        });

        if (sendButton) {
            sendButton.disabled = bloccato || voceOccupata || testo.length === 0;
            sendButton.classList.toggle('is-ready', !bloccato && testo.length > 0);
        }
    },

    // creaAnteprimaMessaggioChat: Ricava il testo sintetico da mostrare nell’anteprima dell’ultimo messaggio.
    // Riceve: messaggio (dati o testo del messaggio).
    creaAnteprimaMessaggioChat(messaggio) {
        // testo: Testo normalizzato o preparato per la rappresentazione corrente.
        const testo = (messaggio?.contenuto || '').trim();
        if (testo) return testo;

        // fileType: Tipo MIME dell’allegato usato per scegliere controlli e rappresentazione.
        const fileType = messaggio?.file_type || '';
        // fileUrl: Riferimento al file allegato da presentare o trasmettere.
        const fileUrl = messaggio?.file_url || '';
        if (fileType.startsWith('image/') || /\.(jpeg|jpg|gif|png|webp)$/i.test(fileUrl)) return 'Immagine condivisa';
        if (fileType.startsWith('audio/') || /\.(webm|mp3|wav|ogg|mp4|aac|m4a)$/i.test(fileUrl)) return 'Messaggio vocale';
        if (fileUrl) return 'File condiviso';
        return 'Nuovo messaggio';
    },

    // aggiornaAnteprimaStanzaMessaggio: Aggiorna l’anteprima e l’ordine della stanza quando arriva un messaggio.
    // Riceve: messaggio (dati o testo del messaggio).
    aggiornaAnteprimaStanzaMessaggio(messaggio) {
        // roomId: Identificativo della stanza a cui appartiene l’operazione.
        const roomId = messaggio?.room || window.stanzaAttuale;
        if (!roomId) return;

        // anteprima: Risultato di creaAnteprimaMessaggioChat. Ricava il testo sintetico da mostrare nell’anteprima
        // dell’ultimo messaggio.
        const anteprima = this.creaAnteprimaMessaggioChat(messaggio);
        // dataInvio: Data e ora del messaggio da formattare o confrontare.
        const dataInvio = messaggio?.data_invio || new Date().toISOString();
        // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
        const stanza = this.getStanzaChat?.(roomId);
        if (stanza) {
            stanza.last_message_preview = anteprima;
            stanza.last_msg_time = dataInvio;
        }

        // item: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const item = document.getElementById(`nav-room-${roomId}`);
        // preview: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const preview = item?.querySelector('.room-preview');
        if (preview) {
            preview.textContent = anteprima;
            preview.classList.add('is-fresh');
        }

        // meta: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const meta = item?.querySelector('.room-meta');
        if (!meta) return;

        // time: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        let time = meta.querySelector('.room-time');
        if (!time) {
            time = this.creaElemento('span', { className: 'room-time' });
            meta.prepend(time);
        }
        time.textContent = this.formattaOrarioStanzaChat(dataInvio);
        time.classList.add('is-fresh');
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        setTimeout(() => {
            preview?.classList.remove('is-fresh');
            time?.classList.remove('is-fresh');
        }, 2500);
    },

    // connettiChat: Avvia o riprende la connessione Socket.IO e aggiorna lo stato della chat.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async connettiChat() {
        if (socket.disconnected) {
            this.aggiornaStatoConnessioneChat('connecting', 'Connessione...');
            socket.connect();
        } else {
            this.aggiornaStatoConnessioneChat(socket.connected ? 'online' : 'connecting');
        }
    },

    // aggiornaModoChatMobile: Seleziona su mobile la lista delle stanze oppure la conversazione.
    // Riceve: mode (modalità richiesta).
    aggiornaModoChatMobile(mode) {
        // container: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const container = document.querySelector('#pagina-chat .chat-container');
        if (!container || !window.app.isMobileLayout?.()) return;

        // isConversation: Indicatore booleano che controlla la condizione descritta dal nome.
        const isConversation = mode === 'conversation';
        container.classList.toggle('is-mobile-list', !isConversation);
        container.classList.toggle('is-mobile-conversation', isConversation);
        document.body.classList.toggle('chat-conversation-open', isConversation);
        document.body.classList.toggle('chat-mobile-list-open', !isConversation);
        document.body.classList.remove('chat-drawer-open');
        document.getElementById('btn-chat-sidebar-toggle')?.setAttribute('aria-expanded', String(isConversation));
    },

    // mostraListaChatMobile: Riporta la chat mobile alla lista delle conversazioni.
    mostraListaChatMobile() {
        this.aggiornaModoChatMobile('list');
        // sidebar: Elemento DOM chat-sidebar: Contenitore dell’interfaccia.
        const sidebar = document.getElementById('chat-sidebar');
        // backdrop: Elemento DOM chat-sidebar-backdrop: Chiudi elenco stanze.
        const backdrop = document.getElementById('chat-sidebar-backdrop');
        sidebar?.classList.remove('mobile-open');
        backdrop?.classList.remove('mobile-open');
    },

    // togglePannelloChatMobile: Alterna la visibilità del pannello della chat mobile o applica lo stato richiesto.
    // Riceve: forceOpen (eventuale stato di apertura imposto).
    togglePannelloChatMobile(forceOpen) {
        // sidebar: Elemento DOM chat-sidebar: Contenitore dell’interfaccia.
        const sidebar = document.getElementById('chat-sidebar');
        // backdrop: Elemento DOM chat-sidebar-backdrop: Chiudi elenco stanze.
        const backdrop = document.getElementById('chat-sidebar-backdrop');
        // toggle: Elemento DOM btn-chat-sidebar-toggle: Apri elenco stanze.
        const toggle = document.getElementById('btn-chat-sidebar-toggle');
        if (!sidebar || !window.app.isMobileLayout?.()) return;

        if (forceOpen !== false && document.body.classList.contains('chat-conversation-open')) {
            this.mostraListaChatMobile();
            toggle?.setAttribute('aria-expanded', 'false');
            return;
        }

        // shouldOpen: Indicatore booleano che controlla la condizione descritta dal nome.
        const shouldOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !sidebar.classList.contains('mobile-open');

        sidebar.classList.toggle('mobile-open', shouldOpen);
        backdrop?.classList.toggle('mobile-open', shouldOpen);
        toggle?.setAttribute('aria-expanded', String(shouldOpen));
        document.body.classList.toggle('chat-drawer-open', shouldOpen);
    },

    // chiudiPannelloChatMobile: Chiude il pannello mobile della chat.
    chiudiPannelloChatMobile() {
        this.togglePannelloChatMobile(false);
    },

    // formattaOrarioStanzaChat: Formatta la data dell’ultimo messaggio per la lista delle conversazioni.
    // Riceve: value (valore da elaborare).
    formattaOrarioStanzaChat(value) {
        if (!value) return '';
        // normalizedValue: Valore scelto tra i due rami in base alla condizione indicata.
        const normalizedValue = typeof value === 'string' ? value.replace(' ', 'T') : value;
        // date: Oggetto Date usato per controllare o rappresentare un riferimento temporale.
        const date = new Date(normalizedValue);
        if (Number.isNaN(date.getTime())) return '';

        // now: Istante attuale in millisecondi usato per scadenze e durate.
        const now = new Date();
        // today: Riferimento temporale rappresentato tramite l’oggetto Date.
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        // messageDay: Riferimento temporale rappresentato tramite l’oggetto Date.
        const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        // yesterday: Riferimento temporale rappresentato tramite l’oggetto Date.
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        if (messageDay.getTime() === today.getTime()) {
            return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        }

        if (messageDay.getTime() === yesterday.getTime()) return 'Ieri';

        if (date.getFullYear() === now.getFullYear()) {
            return date
                .toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
                .replace('.', '');
        }

        return date.toLocaleDateString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        });
    },

    // formattaPartecipantiChat: Costruisce la dicitura del numero di partecipanti.
    // Riceve: count (conteggio da rappresentare).
    formattaPartecipantiChat(count) {
        // numero: Valore convertito o normalizzato prima del suo utilizzo.
        const numero = Number(count);
        // totale: Valore scelto tra i due rami in base alla condizione indicata.
        const totale = Number.isFinite(numero) && numero >= 0 ? Math.round(numero) : 0;
        return `${totale} ${totale === 1 ? 'partecipante' : 'partecipanti'}`;
    },

    // getStanzaChat: Trova i dati della stanza usando il suo identificativo.
    // Riceve: roomId (id della stanza).
    getStanzaChat(roomId) {
        return this.stanzeChatById?.get(roomId) || null;
    },

    // aggiornaMetaChatAttiva: Aggiorna titolo, partecipanti e permessi della conversazione attiva.
    // Riceve: stanza (dati della stanza).
    aggiornaMetaChatAttiva(stanza) {
        // memberCount: Elemento DOM chat-member-count: Etichetta o indicatore dell’interfaccia.
        const memberCount = document.getElementById('chat-member-count');
        if (!memberCount) return;

        // isPrivate: Indicatore booleano che controlla la condizione descritta dal nome.
        const isPrivate = stanza?.tipo === 'private' || String(window.stanzaAttuale || '').startsWith('private_');
        // count: Contatore degli elementi o eventi elaborati dal blocco.
        const count = isPrivate ? 2 : stanza?.participants_count;
        memberCount.textContent = this.formattaPartecipantiChat(count);
    },

    // creaAnteprimaStanzaChat: Costruisce il testo di anteprima della conversazione dai dati caricati.
    // Riceve: stanza (dati della stanza).
    creaAnteprimaStanzaChat(stanza) {
        if (stanza.last_message_preview) return stanza.last_message_preview;
        if (stanza.descrizione) return stanza.descrizione;
        if (stanza.tipo === 'private') return 'Chat privata';
        if (stanza.tipo === 'corso') return 'Stanza del corso';
        if (stanza.tipo === 'gara') return 'Stanza evento';
        return 'Comunità LetsGoSport';
    },

    // creaElementoStanzaChat: Costruisce una voce della lista delle stanze con avatar, nome e indicatore non letto.
    // Riceve: stanza (dati della stanza); unread (presenza di messaggi non letti).
    creaElementoStanzaChat(stanza, unread = false) {
        // type: Tipo dell’elemento o della stanza usato per scegliere il comportamento.
        const type = stanza.tipo || 'general';
        // roomName: Nome leggibile della stanza da mostrare all’utente.
        const roomName = stanza.nome || 'Stanza';
        // item: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const item = this.creaElemento('li', {
            className: `stanza-item room-${type}`,
            attrs: {
                id: `nav-room-${stanza.room_id}`,
                'data-participants-count': String(stanza.participants_count ?? (type === 'private' ? 2 : 0))
            }
        });
        // avatarButton: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const avatarButton = this.creaElemento('button', {
            className: `room-avatar room-avatar-${type}`,
            attrs: {
                type: 'button',
                'aria-label': `Apri il profilo di ${roomName}`
            }
        });

        if ((type === 'corso' || type === 'gara') && stanza.immagine) {
            avatarButton.appendChild(this.creaElemento('img', {
                className: 'room-avatar-image is-square',
                attrs: { src: this.uploadSrc(stanza.immagine), alt: '', loading: 'lazy' }
            }));
        } else if (type === 'private') {
            // otherId: Primo elemento della raccolta che soddisfa il criterio richiesto.
            const otherId = stanza.room_id
                .split('_')
                .slice(1)
                .map(Number)
                // Restituisce il criterio per individuare il primo elemento corrispondente.
                // Riceve: id (identificativo dell’elemento).
                .find(id => id !== Number(window.app.mioId));
            avatarButton.append(
                this.creaElemento('img', {
                    className: 'room-avatar-image',
                    attrs: { src: this.uploadSrc(stanza.immagine), alt: '', loading: 'lazy' }
                }),
                this.creaPallinoStato(otherId, 'pallino-stato-chat')
            );
        } else {
            avatarButton.appendChild(this.creaElemento('span', {
                className: 'room-avatar-emoji',
                text: type === 'gara' ? '🏆' : type === 'corso' ? '📘' : '🌍'
            }));
        }

        // Esegue l’azione del controllo quando viene premuto.
        // Riceve: event (evento del browser).
        avatarButton.addEventListener('click', (event) => {
            event.stopPropagation();
            this.apriMiniProfilo(
                roomName,
                this.uploadSrc(stanza.immagine),
                stanza.descrizione || '',
                stanza.ruolo || '',
                stanza.eta || '--',
                stanza.room_id
            );
        });

        // details: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const details = this.creaElemento('button', {
            className: 'room-details room-open',
            attrs: { type: 'button', 'aria-label': 'Apri chat ' + roomName }
        });
        // mainRow: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const mainRow = this.creaElemento('span', { className: 'room-main-row' });
        mainRow.appendChild(this.creaElemento('span', {
            className: 'room-name',
            text: type === 'general' ? 'Piazza principale' : roomName
        }));
        if (type === 'private' && (stanza.ruolo === 'ADMIN' || stanza.ruolo === 'COACH')) {
            mainRow.appendChild(this.creaBadgeRuoloChat(stanza.ruolo, true));
        }
        details.append(
            mainRow,
            this.creaElemento('span', {
                className: 'room-preview',
                text: this.creaAnteprimaStanzaChat(stanza)
            }),
            this.creaElemento('span', {
                className: 'room-participants',
                text: this.formattaPartecipantiChat(type === 'private' ? 2 : stanza.participants_count)
            })
        );

        // meta: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const meta = this.creaElemento('div', { className: 'room-meta' });
        // time: Risultato di formattaOrarioStanzaChat. Formatta la data dell’ultimo messaggio per la lista delle
        // conversazioni.
        const time = this.formattaOrarioStanzaChat(stanza.last_msg_time);
        if (time) {
            meta.appendChild(this.creaElemento('span', {
                className: 'room-time',
                text: time
            }));
        }

        // unreadBadge: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const unreadBadge = this.creaElemento('span', {
            className: 'room-unread-badge',
            text: '🔔',
            attrs: { id: `badge-${stanza.room_id}`, 'aria-label': 'Nuovi messaggi' }
        });
        unreadBadge.hidden = !unread;
        meta.appendChild(unreadBadge);

        item.append(avatarButton, details, meta);
        // Esegue l’azione del controllo quando viene premuto. Abbandona la stanza precedente, prepara il DOM ed entra
        // nella nuova conversazione.
        item.addEventListener('click', () => this.cambiaStanzaChat(stanza.room_id, roomName));
        return item;
    },

    // aggiornaBottoneNotifiche: Allinea il pulsante allo stato delle notifiche e al supporto del browser.
    aggiornaBottoneNotifiche() {
        // button: Elemento DOM btn-notifiche-desktop: Pulsante del controllo.
        const button = document.getElementById('btn-notifiche-desktop');
        if (!button) return;
        // supported: Risultato di chatNotificheSupportate. Indica se il browser espone le notifiche desktop utilizzate
        // dalla chat.
        const supported = this.chatNotificheSupportate();
        // enabled: Indica se il controllo o la funzionalità devono risultare abilitati.
        const enabled = supported && notificheDesktopAttive && Notification.permission === 'granted';
        button.disabled = !supported;
        if (!supported) {
            button.textContent = '🔕 Non disponibili';
            button.classList.remove('is-enabled');
            button.classList.add('is-disabled');
            return;
        }
        button.textContent = enabled ? '🔔 ON' : '🔕 OFF';
        button.classList.toggle('is-enabled', enabled);
        button.classList.toggle('is-disabled', !enabled);
    },

    // caricaStanzeChat: Richiede le stanze autorizzate, ricostruisce l’elenco e aggiorna la stanza selezionata.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaStanzeChat() {
        this.aggiornaComposerChat?.();
        // btnAdmin: Elemento DOM btn-admin: Pulsante del controllo.
        const btnAdmin = document.getElementById('btn-admin');
        // btnCoach: Elemento DOM btn-coach: Pulsante del controllo.
        const btnCoach = document.getElementById('btn-coach');
        if (btnAdmin && !btnAdmin.classList.contains('hidden')) mioRuoloChat = 'ADMIN';
        else if (btnCoach && !btnCoach.classList.contains('hidden')) mioRuoloChat = 'COACH';
        else mioRuoloChat = 'PARTNER';

        // btnStato: Elemento DOM btn-stato-dnd: Pulsante del controllo.
        const btnStato = document.getElementById('btn-stato-dnd');
        if (btnStato) {
            btnStato.classList.add('is-visible');
            this.aggiornaBottoneStatoDND?.();
        }

        // lista: Elemento DOM lista-stanze-chat: Elemento della pagina.
        const lista = document.getElementById('lista-stanze-chat');
        try {
            if (window.app.isMobileLayout?.() && !document.body.classList.contains('chat-conversation-open')) {
                this.mostraListaChatMobile();
            }
            lista?.replaceChildren(this.creaElemento('li', {
                className: 'chat-list-state',
                text: 'Caricamento chat...'
            }));

            // stanze: Elenco delle stanze disponibili o richieste.
            const stanze = await this.apiRequest('/api/chat/stanze');
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: stanza (dati della stanza).
            this.stanzeChatById = new Map(stanze.map(stanza => [stanza.room_id, stanza]));

            // fragment: Frammento DOM che raccoglie i nodi prima del loro inserimento nel documento.
            const fragment = document.createDocumentFragment();
            // stanzeDaAscoltare: Elenco dei valori che questo blocco deve confrontare, mostrare o elaborare.
            const stanzeDaAscoltare = [];

            if (stanze.length === 0) {
                fragment.appendChild(this.creaElemento('li', {
                    className: 'chat-list-state',
                    text: 'Non hai ancora nessuna chat.'
                }));
            }

            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: stanza (dati della stanza).
            stanze.forEach(stanza => {
                stanzeDaAscoltare.push(stanza.room_id);
                // unread: Indicatore booleano che controlla la condizione descritta dal nome.
                let unread = false;
                if (stanza.last_msg_time) {
                    // ultimoMessaggio: Risultato della chiamata .getTime, riutilizzato nelle istruzioni successive.
                    const ultimoMessaggio = new Date(stanza.last_msg_time).getTime();
                    // ultimaLettura: Valore convertito o normalizzato prima del suo utilizzo.
                    const ultimaLettura = Number(localStorage.getItem('chat_read_' + stanza.room_id) || 0);
                    unread = ultimoMessaggio > (ultimaLettura + 5000);
                }
                fragment.appendChild(this.creaElementoStanzaChat(stanza, unread));
            });

            if (lista) {
                lista.replaceChildren(fragment);
                this.evidenziaStanzaAttiva();
            }
            this.aggiornaMetaChatAttiva(this.getStanzaChat(window.stanzaAttuale));
            this.aggiornaComposerChat?.();
            socket.emit('listen_all_rooms', stanzeDaAscoltare);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            console.error("Errore stanze", error);
            lista?.replaceChildren(this.creaElemento('li', {
                className: 'chat-list-state is-error',
                text: this.apiErrorMessage(error, 'Impossibile caricare le chat. Riprova.')
            }));
        }

        // btnNotifiche: Elemento DOM btn-notifiche-desktop: Pulsante del controllo.
        const btnNotifiche = document.getElementById('btn-notifiche-desktop');
        if (btnNotifiche) {
            btnNotifiche.classList.add('is-visible');
            if (!this.chatNotificheSupportate() || Notification.permission !== 'granted') notificheDesktopAttive = false;
            this.aggiornaBottoneNotifiche();
        }   
    },

    // cambiaStanzaChat: Abbandona la stanza precedente, prepara il DOM ed entra nella nuova conversazione.
    // Riceve: idStanza (id della stanza); nomeStanzaGrafico (nome leggibile della stanza).
    cambiaStanzaChat(idStanza, nomeStanzaGrafico) {
        if (idStanza !== window.stanzaAttuale) this.fermaRegistrazioneVocale?.(true);
        window.stanzaAttuale = idStanza;
        if (socket.disconnected) {
            this.aggiornaStatoConnessioneChat('connecting', 'Connessione...');
            socket.connect();
        } else {
            socket.emit('join_room', window.stanzaAttuale);
        }
        // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
        const stanza = this.getStanzaChat(idStanza) || {
            room_id: idStanza,
            nome: nomeStanzaGrafico,
            tipo: idStanza.startsWith('private_') ? 'private' : idStanza === 'general' ? 'general' : '',
            participants_count: idStanza.startsWith('private_') ? 2 : 0
        };
        document.body.classList.toggle('chat-private-active', stanza.tipo === 'private');
        
        // titolo: Elemento DOM titolo-chat-attiva: Titolo del componente.
        const titolo = document.getElementById('titolo-chat-attiva');
        if (titolo) titolo.innerText = nomeStanzaGrafico || (window.stanzaAttuale === 'general' ? '🌍 Piazza principale' : `Stanza: ${window.stanzaAttuale}`);

        if (titolo && stanza.nome && !nomeStanzaGrafico) titolo.innerText = stanza.nome;
        this.aggiornaMetaChatAttiva(stanza);
        this.aggiornaComposerChat?.();

        // contenitore: Elemento DOM contenitore-messaggi: Messaggi della chat.
        const contenitore = document.getElementById('contenitore-messaggi');
        if (contenitore) {
            contenitore.replaceChildren(this.creaElemento('p', {
                className: 'chat-list-state',
                text: 'Caricamento messaggi...'
            }));
        }

        this.evidenziaStanzaAttiva();
        impostaBadgeStanza(window.stanzaAttuale, false);
        segnaStanzaLetta(window.stanzaAttuale);
        impostaBadgeNavChat(false);

        // btnChiama: Elemento DOM btn-avvia-chiamata: Avvia chiamata.
        const btnChiama = document.getElementById('btn-avvia-chiamata');
        if (btnChiama) btnChiama.style.display = idStanza.startsWith('private_') ? 'flex' : 'none';

        if (window.app.isMobileLayout?.()) {
            this.aggiornaModoChatMobile('conversation');
            this.chiudiPannelloChatMobile();
        }
    },

    // evidenziaStanzaAttiva: Applica lo stato selezionato alla voce della conversazione corrente.
    evidenziaStanzaAttiva() {
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: li (voce della lista delle stanze).
        document.querySelectorAll('.stanza-item').forEach(li => {
            li.classList.remove('attiva');
        });
        // stanzaAttiva: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const stanzaAttiva = document.getElementById(`nav-room-${window.stanzaAttuale}`);
        stanzaAttiva?.classList.add('attiva');
    },

    // spostaStanzaInCima: Porta la conversazione aggiornata all’inizio della lista.
    // Riceve: idStanza (id della stanza).
    spostaStanzaInCima(idStanza) {
        if (idStanza === 'general') return; 
        // lista: Elemento DOM lista-stanze-chat: Elemento della pagina.
        const lista = document.getElementById('lista-stanze-chat');
        // stanzaElement: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const stanzaElement = document.getElementById(`nav-room-${idStanza}`);
        if (lista && stanzaElement && lista.children[1] !== stanzaElement) {
            lista.insertBefore(stanzaElement, lista.children[1]);
            stanzaElement.classList.add('is-bumped');
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            setTimeout(() => {
                stanzaElement.classList.remove('is-bumped');
                this.evidenziaStanzaAttiva();
            }, 400);
        }
    },

    // toggleNotificheDesktop: Richiede o aggiorna la preferenza per le notifiche del browser.
    toggleNotificheDesktop() {
        if (!this.chatNotificheSupportate()) {
            this.mostraNotifica?.('Questo browser non supporta le notifiche desktop.', 'warning');
            this.aggiornaBottoneNotifiche();
            return;
        }

        if (notificheDesktopAttive) {
            notificheDesktopAttive = false;
            localStorage.setItem('notifiche_desktop_attive', 'false');
            this.aggiornaBottoneNotifiche();
        } else {
            // Elabora il risultato quando la Promise precedente si completa con successo.
            // Riceve: permesso (esito dell’autorizzazione del browser).
            Notification.requestPermission().then(permesso => {
                if (permesso === 'granted') {
                    notificheDesktopAttive = true;
                    localStorage.setItem('notifiche_desktop_attive', 'true');
                    this.aggiornaBottoneNotifiche();
                    try {
                        new Notification("Let's Go Sport", { body: "Notifiche attivate.", icon: "uploads/defaults/default_user.png" });
                    } catch (error) {
                        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
                        console.warn("Notifica desktop non mostrata:", error);
                    }
                } else {
                    this.mostraNotifica?.('Autorizza le notifiche dalle impostazioni del browser.', 'warning');
                }
            });
        }
    },

    // lanciaNotificaPush: Mostra la notifica desktop prevista quando le condizioni locali lo permettono.
    lanciaNotificaPush() {
        if (this.chatNotificheSupportate() && notificheDesktopAttive && Notification.permission === 'granted') {
            try {
                // notifica: Istanza di Notification usata dalle operazioni di questo blocco.
                const notifica = new Notification("Let's Go Sport", { body: "Nuovo messaggio", icon: "uploads/defaults/default_user.png" });
                // Esegue l’azione alla scadenza del temporizzatore previsto.
                setTimeout(() => notifica.close(), 4000);
            } catch (error) {
                // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
                console.warn("Notifica desktop non mostrata:", error);
            }
        }
    }
});

// Collega i controlli quando gli elementi HTML sono disponibili nel DOM.
document.addEventListener('DOMContentLoaded', () => {
    // inputChat: Elemento DOM input-messaggio: Campo di input.
    const inputChat = document.getElementById('input-messaggio'); 
    // timerDigitazione: Riferimento o risultato da valorizzare durante l’operazione.
    let timerDigitazione;
    if (inputChat) {
        app.aggiornaComposerChat?.();
        // Aggiorna filtro o stato mentre l’utente modifica il campo.
        inputChat.addEventListener('input', () => {
            app.aggiornaComposerChat?.();
            if (!socket.connected) return;
            socket.emit('sto_scrivendo', window.stanzaAttuale);
            clearTimeout(timerDigitazione);
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            timerDigitazione = setTimeout(() => { socket.emit('ho_smesso_di_scrivere', window.stanzaAttuale); }, 1500);
        });
        // Reagisce all’evento keypress aggiornando i dati o i controlli previsti.
        // Riceve: e (evento del browser).
        inputChat.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && socket.connected) {
                clearTimeout(timerDigitazione);
                socket.emit('ho_smesso_di_scrivere', window.stanzaAttuale);
            }
        });
    }

    // paginaChat: Elemento DOM pagina-chat: Contenitore dell’interfaccia.
    const paginaChat = document.getElementById('pagina-chat');
    // touchStartX: Riferimento o risultato da valorizzare durante l’operazione.
    let touchStartX = null;
    // touchStartY: Riferimento o risultato da valorizzare durante l’operazione.
    let touchStartY = null;

    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: event (evento del browser).
    paginaChat?.addEventListener('touchstart', (event) => {
        // touch: Valore della proprietà event.touches.0, conservato per le operazioni successive.
        const touch = event.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    }, { passive: true });

    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: event (evento del browser).
    paginaChat?.addEventListener('touchend', (event) => {
        if (touchStartX === null || touchStartY === null) return;
        // touch: Valore della proprietà event.changedTouches.0, conservato per le operazioni successive.
        const touch = event.changedTouches[0];
        // deltaX: Risultato del calcolo o del controllo applicato ai valori del blocco.
        const deltaX = touch.clientX - touchStartX;
        // deltaY: Risultato del calcolo o del controllo applicato ai valori del blocco.
        const deltaY = touch.clientY - touchStartY;
        // horizontalSwipe: Indica che il gesto touch soddisfa le condizioni di spostamento orizzontale.
        const horizontalSwipe = Math.abs(deltaX) > 70 && Math.abs(deltaX) > Math.abs(deltaY);

        if (horizontalSwipe && deltaX > 0 && touchStartX < 32) {
            app.togglePannelloChatMobile(true);
        } else if (horizontalSwipe && deltaX < 0) {
            app.chiudiPannelloChatMobile();
        }

        touchStartX = null;
        touchStartY = null;
    }, { passive: true });
});
