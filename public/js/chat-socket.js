window.app = window.app || {};

document.addEventListener('DOMContentLoaded', () => {
    const btnChat = document.getElementById('btn-chat');
    if(btnChat) {
        btnChat.addEventListener('click', () => impostaBadgeNavChat(false));
    }
});

function creaSocketDisabilitato() {
    let avvisoMostrato = false;
    const socketDisabilitato = {
        connected: false,
        disconnected: true,
        on() { return socketDisabilitato; },
        emit() { return socketDisabilitato; },
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

var socket = typeof window.io === 'function'
    ? window.io({ autoConnect: false })
    : creaSocketDisabilitato();
window.socket = socket;
window.stanzaAttuale = 'general';

let mioRuoloChat = 'PARTNER'; 
let notificheDesktopAttive = localStorage.getItem('notifiche_desktop_attive') === 'true';
let radarUtentiOnline = new Map(); 
let mioStatoAttuale = localStorage.getItem('mioStatoDND') || 'ONLINE'; 

function aggiornaRadarChat() {
    app.aggiornaGraficaRadar?.();
}

function impostaBadgeNavChat(visibile) {
    const navBadge = document.getElementById('badge-nav-chat');
    if (!navBadge) return;
    navBadge.hidden = !visibile;
    navBadge.style.display = '';
}

function impostaBadgeStanza(roomId, visibile) {
    const badge = document.getElementById(`badge-${roomId}`);
    if (badge) badge.hidden = !visibile;
}

function chatAttualmenteChiusa() {
    const paginaChat = document.getElementById('pagina-chat');
    return Boolean(paginaChat && paginaChat.classList.contains('hidden'));
}

function segnaStanzaLetta(roomId, timestamp = Date.now()) {
    if (roomId) localStorage.setItem('chat_read_' + roomId, timestamp + 5000);
}

socket.on('connect_error', (err) => {
    console.error("Errore di connessione Socket:", err.message);
    app.aggiornaStatoConnessioneChat?.('error', 'Errore connessione');
});
socket.on('disconnect', (reason) => {
    console.warn("Socket disconnesso:", reason);
    app.aggiornaStatoConnessioneChat?.('offline', 'Offline');
    if (reason === 'io server disconnect' && typeof app.mostraNotifica === 'function') {
        app.mostraNotifica("Sessione chat scaduta. Ricarica la pagina o accedi di nuovo.", "error");
    }
});
socket.on('connect', () => {
    app.aggiornaStatoConnessioneChat?.('online', 'Online');
    socket.emit('join_room', window.stanzaAttuale);
    socket.emit('cambia_stato', mioStatoAttuale); 
});
socket.on('chat_error', (dati) => {
    if(typeof app.mostraNotifica === 'function') app.mostraNotifica(dati.errore, "error");
});

socket.on('utenti_online_iniziali', (mappaStati) => {
    radarUtentiOnline = new Map();
    for (let id in mappaStati) radarUtentiOnline.set(Number(id), mappaStati[id]);
    aggiornaRadarChat();
});
socket.on('utente_connesso', (dati) => {
    radarUtentiOnline.set(Number(dati.id), dati.stato);
    aggiornaRadarChat();
});
socket.on('utente_disconnesso', (payload) => {
    const userId = typeof payload === 'object' ? payload.id : payload;
    radarUtentiOnline.delete(Number(userId));
    aggiornaRadarChat();
});
socket.on('stato_aggiornato', (dati) => {
    radarUtentiOnline.set(Number(dati.id), dati.stato);
    aggiornaRadarChat();
    if (typeof app.caricaStanzeChat === 'function') app.caricaStanzeChat(); 
});
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
socket.on('room_history', (storicoMessaggi) => {
    const contenitore = document.getElementById('contenitore-messaggi');
    if (!contenitore) return;
    contenitore.replaceChildren();

    if (!Array.isArray(storicoMessaggi) || storicoMessaggi.length === 0) {
        const statoVuoto = app.creaStatoVuotoChat?.();
        contenitore.appendChild(statoVuoto || app.creaElemento('p', {
            className: 'chat-list-state',
            text: 'Ancora nessun messaggio. Scrivi tu per primo.'
        }));
        app.scrollaChatInFondo?.(true);
        return;
    }
    
    let orarioPiuRecente = 0;
    storicoMessaggi.forEach(msg => {
        if(typeof app.stampaFumetto === 'function') app.stampaFumetto(msg, { skipScroll: true });
        const tempoMsg = new Date(msg.data_invio).getTime();
        if (tempoMsg > orarioPiuRecente) orarioPiuRecente = tempoMsg;
    });
    if (orarioPiuRecente > 0) segnaStanzaLetta(window.stanzaAttuale, orarioPiuRecente);
    app.scrollaChatInFondo?.(true);
});
socket.on('message_deleted', (msgId) => {
    const fumetto = document.getElementById(`msg-${msgId}`);
    if (fumetto) {
        fumetto.style.opacity = '0';
        setTimeout(() => fumetto.remove(), 300);
    }
});
socket.on('sveglia_nuova_chat', (room_id) => {
    const roomId = typeof room_id === 'string' ? room_id : '';
    if (!roomId) return;

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
socket.on('utente_sta_scrivendo', (data) => {
    const indicatore = document.getElementById('indicatore-scrittura');
    if (indicatore) { indicatore.innerText = `✍️ ${data.nome} sta scrivendo...`; indicatore.style.display = 'block'; }
});
socket.on('utente_ha_smesso', () => {
    const indicatore = document.getElementById('indicatore-scrittura');
    if (indicatore) { indicatore.style.display = 'none'; indicatore.innerText = ''; }
});

Object.assign(window.app, {
    chatNotificheSupportate() {
        return typeof window.Notification === 'function';
    },

    isSocketChatPronto() {
        return typeof socket !== 'undefined' && socket.connected;
    },

    nomeStanzaChatAttiva() {
        const stanza = this.getStanzaChat?.(window.stanzaAttuale);
        if (window.stanzaAttuale === 'general') return 'Piazza principale';
        if (stanza?.nome) return stanza.nome;

        const titolo = document.getElementById('titolo-chat-attiva')?.textContent?.trim();
        return titolo || 'questa chat';
    },

    aggiornaStatoConnessioneChat(stato = 'offline', testo) {
        const status = document.getElementById('chat-connection-status');
        const labels = {
            online: 'Online',
            connecting: 'Connessione...',
            offline: 'Offline',
            error: 'Errore'
        };
        const statoPulito = labels[stato] ? stato : 'offline';

        if (status) {
            status.textContent = testo || labels[statoPulito];
            status.className = `chat-connection-status is-${statoPulito}`;
        }

        document.body.classList.toggle('chat-is-online', statoPulito === 'online');
        document.body.classList.toggle('chat-is-offline', statoPulito !== 'online');
        this.aggiornaComposerChat?.();
    },

    aggiornaComposerChat() {
        const composer = document.querySelector('#pagina-chat .chat-composer');
        const input = document.getElementById('input-messaggio');
        const attachButton = document.getElementById('btn-allega-chat');
        const recordButton = document.getElementById('btn-registra-vocale');
        const sendButton = document.getElementById('btn-invia-chat');
        const testo = input?.value.trim() || '';
        const connesso = this.isSocketChatPronto();
        const bloccato = !window.app.mioId || !connesso;

        composer?.classList.toggle('is-disabled', bloccato);
        composer?.classList.toggle('is-ready', !bloccato);

        if (input) {
            input.disabled = bloccato;
            input.placeholder = bloccato
                ? 'Connessione chat in corso...'
                : `Scrivi in ${this.nomeStanzaChatAttiva()}...`;
        }

        [attachButton, recordButton].forEach(button => {
            if (button) button.disabled = bloccato;
        });

        if (sendButton) {
            sendButton.disabled = bloccato || testo.length === 0;
            sendButton.classList.toggle('is-ready', !bloccato && testo.length > 0);
        }
    },

    creaAnteprimaMessaggioChat(messaggio) {
        const testo = (messaggio?.contenuto || '').trim();
        if (testo) return testo;

        const fileType = messaggio?.file_type || '';
        const fileUrl = messaggio?.file_url || '';
        if (fileType.startsWith('image/') || /\.(jpeg|jpg|gif|png|webp)$/i.test(fileUrl)) return 'Immagine condivisa';
        if (fileType.startsWith('audio/') || /\.(webm|mp3|wav|ogg|mp4|aac|m4a)$/i.test(fileUrl)) return 'Messaggio vocale';
        if (fileUrl) return 'File condiviso';
        return 'Nuovo messaggio';
    },

    aggiornaAnteprimaStanzaMessaggio(messaggio) {
        const roomId = messaggio?.room || window.stanzaAttuale;
        if (!roomId) return;

        const anteprima = this.creaAnteprimaMessaggioChat(messaggio);
        const dataInvio = messaggio?.data_invio || new Date().toISOString();
        const stanza = this.getStanzaChat?.(roomId);
        if (stanza) {
            stanza.last_message_preview = anteprima;
            stanza.last_msg_time = dataInvio;
        }

        const item = document.getElementById(`nav-room-${roomId}`);
        const preview = item?.querySelector('.room-preview');
        if (preview) {
            preview.textContent = anteprima;
            preview.classList.add('is-fresh');
        }

        const meta = item?.querySelector('.room-meta');
        if (!meta) return;

        let time = meta.querySelector('.room-time');
        if (!time) {
            time = this.creaElemento('span', { className: 'room-time' });
            meta.prepend(time);
        }
        time.textContent = this.formattaOrarioStanzaChat(dataInvio);
        time.classList.add('is-fresh');
        setTimeout(() => {
            preview?.classList.remove('is-fresh');
            time?.classList.remove('is-fresh');
        }, 2500);
    },

    async connettiChat() {
        if (socket.disconnected) {
            this.aggiornaStatoConnessioneChat('connecting', 'Connessione...');
            socket.connect();
        } else {
            this.aggiornaStatoConnessioneChat(socket.connected ? 'online' : 'connecting');
        }
    },

    aggiornaModoChatMobile(mode) {
        const container = document.querySelector('#pagina-chat .chat-container');
        if (!container || !window.app.isMobileLayout?.()) return;

        const isConversation = mode === 'conversation';
        container.classList.toggle('is-mobile-list', !isConversation);
        container.classList.toggle('is-mobile-conversation', isConversation);
        document.body.classList.toggle('chat-conversation-open', isConversation);
        document.body.classList.toggle('chat-mobile-list-open', !isConversation);
        document.body.classList.remove('chat-drawer-open');
        document.getElementById('btn-chat-sidebar-toggle')?.setAttribute('aria-expanded', String(isConversation));
    },

    mostraListaChatMobile() {
        this.aggiornaModoChatMobile('list');
        const sidebar = document.getElementById('chat-sidebar');
        const backdrop = document.getElementById('chat-sidebar-backdrop');
        sidebar?.classList.remove('mobile-open');
        backdrop?.classList.remove('mobile-open');
    },

    togglePannelloChatMobile(forceOpen) {
        const sidebar = document.getElementById('chat-sidebar');
        const backdrop = document.getElementById('chat-sidebar-backdrop');
        const toggle = document.getElementById('btn-chat-sidebar-toggle');
        if (!sidebar || !window.app.isMobileLayout?.()) return;

        if (forceOpen !== false && document.body.classList.contains('chat-conversation-open')) {
            this.mostraListaChatMobile();
            toggle?.setAttribute('aria-expanded', 'false');
            return;
        }

        const shouldOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !sidebar.classList.contains('mobile-open');

        sidebar.classList.toggle('mobile-open', shouldOpen);
        backdrop?.classList.toggle('mobile-open', shouldOpen);
        toggle?.setAttribute('aria-expanded', String(shouldOpen));
        document.body.classList.toggle('chat-drawer-open', shouldOpen);
    },

    chiudiPannelloChatMobile() {
        this.togglePannelloChatMobile(false);
    },

    formattaOrarioStanzaChat(value) {
        if (!value) return '';
        const normalizedValue = typeof value === 'string' ? value.replace(' ', 'T') : value;
        const date = new Date(normalizedValue);
        if (Number.isNaN(date.getTime())) return '';

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
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

    formattaPartecipantiChat(count) {
        const numero = Number(count);
        const totale = Number.isFinite(numero) && numero >= 0 ? Math.round(numero) : 0;
        return `${totale} ${totale === 1 ? 'partecipante' : 'partecipanti'}`;
    },

    getStanzaChat(roomId) {
        return this.stanzeChatById?.get(roomId) || null;
    },

    aggiornaMetaChatAttiva(stanza) {
        const memberCount = document.getElementById('chat-member-count');
        if (!memberCount) return;

        const isPrivate = stanza?.tipo === 'private' || String(window.stanzaAttuale || '').startsWith('private_');
        const count = isPrivate ? 2 : stanza?.participants_count;
        memberCount.textContent = this.formattaPartecipantiChat(count);
    },

    creaAnteprimaStanzaChat(stanza) {
        if (stanza.last_message_preview) return stanza.last_message_preview;
        if (stanza.descrizione) return stanza.descrizione;
        if (stanza.tipo === 'private') return 'Chat privata';
        if (stanza.tipo === 'corso') return 'Stanza del corso';
        if (stanza.tipo === 'gara') return 'Stanza evento';
        return 'Comunità LetsGoSport';
    },

    creaElementoStanzaChat(stanza, unread = false) {
        const type = stanza.tipo || 'general';
        const roomName = stanza.nome || 'Stanza';
        const item = this.creaElemento('li', {
            className: `stanza-item room-${type}`,
            attrs: {
                id: `nav-room-${stanza.room_id}`,
                'data-participants-count': String(stanza.participants_count ?? (type === 'private' ? 2 : 0))
            }
        });
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
            const otherId = stanza.room_id
                .split('_')
                .slice(1)
                .map(Number)
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

        const details = this.creaElemento('div', { className: 'room-details' });
        const mainRow = this.creaElemento('div', { className: 'room-main-row' });
        mainRow.appendChild(this.creaElemento('div', {
            className: 'room-name',
            text: type === 'general' ? 'Piazza principale' : roomName
        }));
        if (type === 'private' && (stanza.ruolo === 'ADMIN' || stanza.ruolo === 'COACH')) {
            mainRow.appendChild(this.creaBadgeRuoloChat(stanza.ruolo, true));
        }
        details.append(
            mainRow,
            this.creaElemento('div', {
                className: 'room-preview',
                text: this.creaAnteprimaStanzaChat(stanza)
            }),
            this.creaElemento('div', {
                className: 'room-participants',
                text: this.formattaPartecipantiChat(type === 'private' ? 2 : stanza.participants_count)
            })
        );

        const meta = this.creaElemento('div', { className: 'room-meta' });
        const time = this.formattaOrarioStanzaChat(stanza.last_msg_time);
        if (time) {
            meta.appendChild(this.creaElemento('span', {
                className: 'room-time',
                text: time
            }));
        }

        const unreadBadge = this.creaElemento('span', {
            className: 'room-unread-badge',
            text: '🔔',
            attrs: { id: `badge-${stanza.room_id}`, 'aria-label': 'Nuovi messaggi' }
        });
        unreadBadge.hidden = !unread;
        meta.appendChild(unreadBadge);

        item.append(avatarButton, details, meta);
        item.addEventListener('click', () => this.cambiaStanzaChat(stanza.room_id, roomName));
        return item;
    },

    aggiornaBottoneNotifiche() {
        const button = document.getElementById('btn-notifiche-desktop');
        if (!button) return;
        const supported = this.chatNotificheSupportate();
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

    async caricaStanzeChat() {
        this.aggiornaComposerChat?.();
        const btnAdmin = document.getElementById('btn-admin');
        const btnCoach = document.getElementById('btn-coach');
        if (btnAdmin && !btnAdmin.classList.contains('hidden')) mioRuoloChat = 'ADMIN';
        else if (btnCoach && !btnCoach.classList.contains('hidden')) mioRuoloChat = 'COACH';
        else mioRuoloChat = 'PARTNER';

        const btnStato = document.getElementById('btn-stato-dnd');
        if (btnStato) {
            btnStato.classList.add('is-visible');
            this.aggiornaBottoneStatoDND?.();
        }

        const lista = document.getElementById('lista-stanze-chat');
        try {
            if (window.app.isMobileLayout?.() && !document.body.classList.contains('chat-conversation-open')) {
                this.mostraListaChatMobile();
            }
            lista?.replaceChildren(this.creaElemento('li', {
                className: 'chat-list-state',
                text: 'Caricamento chat...'
            }));

            const stanze = await this.apiRequest('/api/chat/stanze');
            this.stanzeChatById = new Map(stanze.map(stanza => [stanza.room_id, stanza]));

            const fragment = document.createDocumentFragment();
            const stanzeDaAscoltare = [];

            if (stanze.length === 0) {
                fragment.appendChild(this.creaElemento('li', {
                    className: 'chat-list-state',
                    text: 'Non hai ancora nessuna chat.'
                }));
            }

            stanze.forEach(stanza => {
                stanzeDaAscoltare.push(stanza.room_id);
                let unread = false;
                if (stanza.last_msg_time) {
                    const ultimoMessaggio = new Date(stanza.last_msg_time).getTime();
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
            console.error("Errore stanze", error);
            lista?.replaceChildren(this.creaElemento('li', {
                className: 'chat-list-state is-error',
                text: this.apiErrorMessage(error, 'Impossibile caricare le chat. Riprova.')
            }));
        }

        const btnNotifiche = document.getElementById('btn-notifiche-desktop');
        if (btnNotifiche) {
            btnNotifiche.classList.add('is-visible');
            if (!this.chatNotificheSupportate() || Notification.permission !== 'granted') notificheDesktopAttive = false;
            this.aggiornaBottoneNotifiche();
        }   
    },

    cambiaStanzaChat(idStanza, nomeStanzaGrafico) {
        window.stanzaAttuale = idStanza;
        if (socket.disconnected) {
            this.aggiornaStatoConnessioneChat('connecting', 'Connessione...');
            socket.connect();
        } else {
            socket.emit('join_room', window.stanzaAttuale);
        }
        const stanza = this.getStanzaChat(idStanza) || {
            room_id: idStanza,
            nome: nomeStanzaGrafico,
            tipo: idStanza.startsWith('private_') ? 'private' : idStanza === 'general' ? 'general' : '',
            participants_count: idStanza.startsWith('private_') ? 2 : 0
        };
        document.body.classList.toggle('chat-private-active', stanza.tipo === 'private');
        
        const titolo = document.getElementById('titolo-chat-attiva');
        if (titolo) titolo.innerText = nomeStanzaGrafico || (window.stanzaAttuale === 'general' ? '🌍 Piazza principale' : `Stanza: ${window.stanzaAttuale}`);

        if (titolo && stanza.nome && !nomeStanzaGrafico) titolo.innerText = stanza.nome;
        this.aggiornaMetaChatAttiva(stanza);
        this.aggiornaComposerChat?.();

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

        const btnChiama = document.getElementById('btn-avvia-chiamata');
        if (btnChiama) btnChiama.style.display = idStanza.startsWith('private_') ? 'flex' : 'none';

        if (window.app.isMobileLayout?.()) {
            this.aggiornaModoChatMobile('conversation');
            this.chiudiPannelloChatMobile();
        }
    },

    evidenziaStanzaAttiva() {
        document.querySelectorAll('.stanza-item').forEach(li => {
            li.classList.remove('attiva');
        });
        const stanzaAttiva = document.getElementById(`nav-room-${window.stanzaAttuale}`);
        stanzaAttiva?.classList.add('attiva');
    },

    spostaStanzaInCima(idStanza) {
        if (idStanza === 'general') return; 
        const lista = document.getElementById('lista-stanze-chat');
        const stanzaElement = document.getElementById(`nav-room-${idStanza}`);
        if (lista && stanzaElement && lista.children[1] !== stanzaElement) {
            lista.insertBefore(stanzaElement, lista.children[1]);
            stanzaElement.classList.add('is-bumped');
            setTimeout(() => {
                stanzaElement.classList.remove('is-bumped');
                this.evidenziaStanzaAttiva();
            }, 400);
        }
    },

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
            Notification.requestPermission().then(permesso => {
                if (permesso === 'granted') {
                    notificheDesktopAttive = true;
                    localStorage.setItem('notifiche_desktop_attive', 'true');
                    this.aggiornaBottoneNotifiche();
                    try {
                        new Notification("Let's Go Sport", { body: "Notifiche attivate.", icon: "uploads/defaults/default_user.png" });
                    } catch (error) {
                        console.warn("Notifica desktop non mostrata:", error);
                    }
                } else {
                    this.mostraNotifica?.('Autorizza le notifiche dalle impostazioni del browser.', 'warning');
                }
            });
        }
    },

    lanciaNotificaPush() {
        if (this.chatNotificheSupportate() && notificheDesktopAttive && Notification.permission === 'granted') {
            try {
                const notifica = new Notification("Let's Go Sport", { body: "Nuovo messaggio", icon: "uploads/defaults/default_user.png" });
                setTimeout(() => notifica.close(), 4000);
            } catch (error) {
                console.warn("Notifica desktop non mostrata:", error);
            }
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const inputChat = document.getElementById('input-messaggio'); 
    let timerDigitazione;
    if (inputChat) {
        app.aggiornaComposerChat?.();
        inputChat.addEventListener('input', () => {
            app.aggiornaComposerChat?.();
            if (!socket.connected) return;
            socket.emit('sto_scrivendo', window.stanzaAttuale);
            clearTimeout(timerDigitazione);
            timerDigitazione = setTimeout(() => { socket.emit('ho_smesso_di_scrivere', window.stanzaAttuale); }, 1500);
        });
        inputChat.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && socket.connected) {
                clearTimeout(timerDigitazione);
                socket.emit('ho_smesso_di_scrivere', window.stanzaAttuale);
            }
        });
    }

    const paginaChat = document.getElementById('pagina-chat');
    let touchStartX = null;
    let touchStartY = null;

    paginaChat?.addEventListener('touchstart', (event) => {
        const touch = event.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
    }, { passive: true });

    paginaChat?.addEventListener('touchend', (event) => {
        if (touchStartX === null || touchStartY === null) return;
        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
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
