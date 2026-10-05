window.app = window.app || {};

Object.assign(window.app, {

    inviaMessaggio() {
        const input = document.getElementById('input-messaggio');
        if (!input) return;
        const testo = input.value.trim();
        this.aggiornaComposerChat?.();
        if (testo === '') return;
        
        if (!socket.connected) {
            if (typeof app.mostraNotifica === 'function') app.mostraNotifica("Chat non connessa. Attendi qualche secondo.", "warning");
            this.aggiornaComposerChat?.();
            return;
        }

        socket.emit('send_message', { room: window.stanzaAttuale, contenuto: testo });
        input.value = '';
        this.aggiornaComposerChat?.();
    },

    async eliminaMessaggio(idMessaggio) {
        const confirmed = await this.confermaAzione({
            titolo: 'Eliminare il messaggio?',
            messaggio: 'Il messaggio verrà rimosso dalla chat per tutti.',
            testoConferma: 'Elimina messaggio',
            tipo: 'danger'
        });
        if (confirmed) socket.emit('delete_message', idMessaggio);
    },

    async caricaFileChat(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!socket.connected) {
            this.mostraNotifica?.("Chat non connessa. Attendi qualche secondo.", "warning");
            event.target.value = '';
            this.aggiornaComposerChat?.();
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            this.mostraNotifica?.("Il file è troppo grande. Max 10 MB.", "warning");
            event.target.value = '';
            this.aggiornaComposerChat?.();
            return;
        }

        const formData = new FormData();
        formData.append('file_chat', file);
        const attachButton = document.getElementById('btn-allega-chat');
        attachButton?.classList.add('is-uploading');
        if (attachButton) attachButton.disabled = true;

        try {
            if (typeof this.mostraNotifica === 'function') this.mostraNotifica("Caricamento file in corso...", "info");
            const uploadUrl = `/api/chat/upload?room=${encodeURIComponent(window.stanzaAttuale || '')}`;
            const risultato = await this.apiRequest(uploadUrl, {
                method: 'POST',
                body: formData,
                timeout: 30000
            });
            if (!socket.connected) {
                this.mostraNotifica?.("Connessione chat persa. Riprova tra qualche secondo.", "warning");
                return;
            }
            socket.emit('send_message', {
                room: window.stanzaAttuale,
                contenuto: '',
                file_url: risultato.file_url,
                file_type: risultato.file_type,
                upload_token: risultato.upload_token
            });
        } catch (error) {
            if (typeof this.mostraNotifica === 'function') {
                this.mostraNotifica(
                    this.apiErrorMessage(error, "Errore durante l'invio del file."),
                    "error"
                );
            }
        } finally {
            attachButton?.classList.remove('is-uploading');
            event.target.value = '';
            this.aggiornaComposerChat?.();
        }
    },
    creaAllegatoMessaggio(messaggio) {
        if (!messaggio.file_url) return null;

        const fileUrl = this.uploadSrc(messaggio.file_url, '');
        const fileType = messaggio.file_type || '';
        const isImage = fileType.startsWith('image/')
            || /\.(jpeg|jpg|gif|png|webp)$/i.test(messaggio.file_url);
        const isAudio = fileType.startsWith('audio/')
            || /\.(webm|mp3|wav|ogg|mp4|aac|m4a)$/i.test(messaggio.file_url);

        if (isImage) {
            const image = this.creaElemento('img', {
                className: 'msg-img-allegata',
                attrs: {
                    src: fileUrl,
                    alt: 'Immagine allegata al messaggio',
                    loading: 'lazy',
                    decoding: 'async'
                }
            });
            image.addEventListener('click', () => this.apriImmagineFullscreen(image.src));
            return image;
        }

        if (isAudio && typeof this.generaPlayerAudio === 'function') {
            return this.generaPlayerAudio(messaggio);
        }

        let nomeFile = messaggio.file_url;
        const primoUnderscore = nomeFile.indexOf('_');
        if (primoUnderscore !== -1) nomeFile = nomeFile.substring(primoUnderscore + 1);

        const fileBox = this.creaElemento('div', { className: 'msg-file-box' });
        const icon = this.creaElemento('span', {
            className: 'msg-file-icon',
            text: '📄'
        });
        const details = this.creaElemento('div', { className: 'msg-file-details' });
        const name = this.creaElemento('div', {
            className: 'msg-file-name',
            text: nomeFile,
            attrs: { title: nomeFile }
        });
        const download = this.creaElemento('a', {
            className: 'msg-file-btn',
            text: 'Scarica file',
            attrs: {
                href: fileUrl,
                target: '_blank',
                download: '',
                rel: 'noopener'
            }
        });
        details.append(name, download);
        fileBox.append(icon, details);
        return fileBox;
    },

    chatInFondo(margine = 120) {
        const contenitore = document.getElementById('contenitore-messaggi');
        if (!contenitore) return true;
        return contenitore.scrollHeight - contenitore.scrollTop - contenitore.clientHeight <= margine;
    },

    creaPulsanteFondoChat() {
        const esistente = document.getElementById('btn-chat-scroll-bottom');
        if (esistente) return esistente;

        const button = this.creaElemento('button', {
            className: 'chat-scroll-bottom',
            text: 'Vai agli ultimi messaggi',
            attrs: {
                id: 'btn-chat-scroll-bottom',
                type: 'button'
            }
        });
        button.addEventListener('click', () => this.scrollaChatInFondo(true));
        return button;
    },

    mostraPulsanteFondoChat(mostra = true) {
        const contenitore = document.getElementById('contenitore-messaggi');
        if (!contenitore) return;

        const button = mostra
            ? this.creaPulsanteFondoChat()
            : document.getElementById('btn-chat-scroll-bottom');
        if (!button) return;
        if (mostra || !button.parentElement) contenitore.appendChild(button);
        button.hidden = !mostra;
    },

    creaStatoVuotoChat() {
        const stanza = this.getStanzaChat?.(window.stanzaAttuale);
        const isGeneral = window.stanzaAttuale === 'general';
        const title = isGeneral ? 'La Piazza principale è pronta' : 'Ancora nessun messaggio';
        const copy = isGeneral
            ? 'Apri la conversazione con un saluto, una domanda o un aggiornamento utile.'
            : `Scrivi in ${stanza?.nome || 'questa chat'} e fai partire la conversazione.`;

        const wrapper = this.creaElemento('div', {
            className: 'chat-empty-state',
            attrs: { role: 'status' }
        });
        wrapper.append(
            this.creaElemento('span', {
                className: 'chat-empty-icon',
                text: 'LS',
                attrs: { 'aria-hidden': 'true' }
            }),
            this.creaElemento('strong', {
                className: 'chat-empty-title',
                text: title
            }),
            this.creaElemento('p', {
                className: 'chat-empty-copy',
                text: copy
            })
        );
        return wrapper;
    },

    stampaFumetto(messaggio, opzioni = {}) {
        const contenitore = document.getElementById('contenitore-messaggi');
        if (!contenitore) return;
        
        const isMioMessaggio = (messaggio.user_id === window.app.mioId);
        const restaInFondo = !opzioni.skipScroll && (opzioni.forceScroll === true || isMioMessaggio || this.chatInFondo());
        contenitore.querySelector('.chat-empty-state')?.remove();
        contenitore.querySelector('.chat-list-state')?.remove();

        const avatar = this.creaElemento('img', {
            className: 'msg-avatar',
            attrs: {
                src: this.uploadSrc(messaggio.propic),
                alt: `Foto di ${messaggio.nome || ''} ${messaggio.cognome || ''}`.trim(),
                loading: 'lazy',
                decoding: 'async'
            }
        });
        const riga = this.creaElemento('div', {
            className: `msg-row ${isMioMessaggio ? 'mio' : 'altro'}`
        });
        riga.id = `msg-${messaggio.id}`;
        const orario = new Date(messaggio.data_invio).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const bubble = this.creaElemento('div', {
            className: `msg-bubble ${isMioMessaggio ? 'mio' : 'altro'}`
        });

        if (!isMioMessaggio) {
            bubble.appendChild(this.creaElemento('div', {
                className: 'msg-mittente',
                text: `${messaggio.nome || ''} ${messaggio.cognome || ''}`.trim()
            }));
        }

        const attachment = this.creaAllegatoMessaggio(messaggio);
        if (attachment) bubble.appendChild(attachment);

        if (messaggio.contenuto) {
            bubble.appendChild(this.creaElemento('div', {
                className: 'msg-testo',
                text: messaggio.contenuto
            }));
        }

        const info = this.creaElemento('div', { className: 'msg-info' });
        info.appendChild(this.creaElemento('span', { text: orario }));
        const ruoloSicuro = (typeof mioRuoloChat !== 'undefined') ? mioRuoloChat : (window.app.mioRuolo || '');
        const stanzaMessaggio = this.getStanzaChat?.(messaggio.room || window.stanzaAttuale);
        const puoEliminareMessaggi = stanzaMessaggio?.can_delete_messages === true || (!stanzaMessaggio && ruoloSicuro === 'ADMIN');
        if (puoEliminareMessaggi) {
            const deleteButton = this.creaElemento('button', {
                className: 'msg-delete-btn',
                attrs: {
                    type: 'button',
                    title: 'Elimina messaggio',
                    'aria-label': 'Elimina messaggio'
                }
            });
            deleteButton.appendChild(this.creaElemento('img', {
                className: 'msg-cestino',
                attrs: { src: 'uploads/buttons/tasto_cestino.png', alt: '' }
            }));
            deleteButton.addEventListener('click', () => this.eliminaMessaggio(messaggio.id));
            info.appendChild(deleteButton);
        }

        bubble.appendChild(info);
        if (isMioMessaggio) riga.append(bubble, avatar);
        else riga.append(avatar, bubble);
        contenitore.appendChild(riga);
        if (opzioni.skipScroll) return;
        if (restaInFondo) this.scrollaChatInFondo(opzioni.immediato === true);
        else this.mostraPulsanteFondoChat(true);
    },


    scrollaChatInFondo(immediato = false) {
        const contenitore = document.getElementById('contenitore-messaggi');
        if (!contenitore) return;

        const scorri = () => {
            contenitore.scrollTop = contenitore.scrollHeight;
            this.mostraPulsanteFondoChat(false);
        };

        if (immediato) scorri();
        else setTimeout(scorri, 100);
    },

    creaBadgeRuoloChat(ruolo, compact = false) {
        const labels = {
            ADMIN: 'ADMIN',
            COACH: 'COACH',
            PARTNER: 'Iscritto'
        };
        if (!labels[ruolo]) return null;

        return this.creaElemento('span', {
            className: `role-badge role-badge-${ruolo.toLowerCase()}${compact ? ' is-compact' : ''}`,
            text: labels[ruolo]
        });
    },

    creaPallinoStato(userId, className = 'pallino-stato') {
        const dot = this.creaElemento('span', {
            className,
            attrs: { 'data-id': userId, 'aria-hidden': 'true' }
        });
        dot.style.setProperty('--presence-color', this.getColorePallino(userId));
        return dot;
    },

    creaContattoElemento(contatto) {
        const item = this.creaElemento('button', {
            className: 'contatto-item',
            attrs: { type: 'button' }
        });
        const avatarWrapper = this.creaElemento('span', { className: 'contact-avatar-wrap' });
        const avatar = this.creaElemento('img', {
            className: 'contact-avatar',
            attrs: {
                src: this.uploadSrc(contatto.propic),
                alt: `Foto di ${contatto.nome || ''} ${contatto.cognome || ''}`.trim(),
                loading: 'lazy'
            }
        });
        avatarWrapper.append(avatar, this.creaPallinoStato(contatto.id));

        const content = this.creaElemento('span', { className: 'contact-content' });
        const name = this.creaElemento('span', {
            className: 'nome-contatto',
            text: `${contatto.nome || ''} ${contatto.cognome || ''}`.trim()
        });
        if (contatto.ruolo === 'ADMIN' || contatto.ruolo === 'COACH') {
            name.appendChild(this.creaBadgeRuoloChat(contatto.ruolo, true));
        }
        content.appendChild(name);

        const chatIcon = this.creaElemento('span', {
            className: 'contact-chat-icon',
            text: '💬',
            attrs: { 'aria-hidden': 'true' }
        });
        item.append(avatarWrapper, content, chatIcon);
        item.addEventListener('click', () => {
            this.avviaChatPrivata(
                contatto.id,
                `${contatto.nome || ''} ${contatto.cognome || ''}`.trim(),
                contatto.propic || '',
                contatto.ruolo || ''
            );
        });
        return item;
    },

    mostraStatoListaContatti(container, message, type = '') {
        if (!container) return;
        container.replaceChildren(this.creaElemento('p', {
            className: `chat-list-state${type ? ` is-${type}` : ''}`,
            text: message
        }));
    },

    async apriModaleContatti() {
        if(typeof this.apriModale === 'function') this.apriModale('modale-contatti');
        const contenitore = document.getElementById('lista-contatti');
        this.mostraStatoListaContatti(contenitore, 'Ricerca contatti...');
        const barraRicerca = document.getElementById('input-cerca-contatti'); if (barraRicerca) barraRicerca.value = '';

        try {
            const contatti = await this.apiRequest('/api/chat/contatti');
            if (contatti.length === 0) {
                this.mostraStatoListaContatti(contenitore, 'Nessun contatto disponibile.');
                return;
            }

            const fragment = document.createDocumentFragment();
            contatti.forEach(contatto => fragment.appendChild(this.creaContattoElemento(contatto)));
            contenitore.replaceChildren(fragment);
        } catch (error) {
            this.mostraStatoListaContatti(
                contenitore,
                this.apiErrorMessage(error, 'Errore di caricamento.'),
                'error'
            );
        }
    },

    filtraContatti() {
        const input = document.getElementById('input-cerca-contatti'); if(!input) return;
        const val = input.value.toLowerCase();
        document.querySelectorAll('.contatto-item').forEach(contatto => {
            const nomeEl = contatto.querySelector('.nome-contatto');
            if (nomeEl) contatto.hidden = !nomeEl.textContent.toLowerCase().includes(val);
        });
    },

    avviaChatPrivata(altroId, altroNome, propic = '', ruolo = '') {
        if(typeof this.chiudiModale === 'function') this.chiudiModale('modale-contatti');
        const mioId = window.app.mioId;
        const room_id = `private_${Math.min(mioId, altroId)}_${Math.max(mioId, altroId)}`;

        if (!document.getElementById(`nav-room-${room_id}`)) {
            const lista = document.getElementById('lista-stanze-chat');
            if (!this.stanzeChatById) this.stanzeChatById = new Map();
            const datiStanza = {
                room_id,
                nome: altroNome,
                tipo: 'private',
                immagine: propic,
                ruolo,
                eta: '--',
                participants_count: 2,
                can_delete_messages: mioRuoloChat === 'ADMIN' || mioRuoloChat === 'COACH'
            };
            this.stanzeChatById.set(room_id, datiStanza);
            const stanza = this.creaElementoStanzaChat?.(datiStanza, false);
            if (lista && stanza) {
                if (lista.children.length > 0) lista.children[0].after(stanza);
                else lista.appendChild(stanza);
            }
            socket.emit('listen_all_rooms', [room_id]);
        }
        
        if (typeof app.cambiaStanzaChat === 'function') app.cambiaStanzaChat(room_id, altroNome);
        if (typeof app.spostaStanzaInCima === 'function') app.spostaStanzaInCima(room_id);
    },

    getColorePallino(userId) {
        if (!radarUtentiOnline.has(Number(userId))) return '#dfe4ea'; 
        return radarUtentiOnline.get(Number(userId)) === 'DND' ? '#ff4757' : '#2ed573'; 
    },
    
    aggiornaGraficaRadar() {
        const pallini = document.querySelectorAll('.pallino-stato, .pallino-stato-chat');
        pallini.forEach(p => {
            const idContatto = Number(p.dataset.id);
            p.style.setProperty('--presence-color', this.getColorePallino(idContatto));
        });
    },

    aggiornaBottoneStatoDND() {
        const button = document.getElementById('btn-stato-dnd');
        if (!button) return;
        const isDnd = mioStatoAttuale === 'DND';
        button.textContent = isDnd ? '🔴 Stato: non disturbare' : '🟢 Stato: disponibile';
        button.classList.toggle('is-dnd', isDnd);
        button.classList.toggle('is-online', !isDnd);
    },
    
    toggleStatoDND() {
        mioStatoAttuale = (mioStatoAttuale === 'ONLINE') ? 'DND' : 'ONLINE';
        localStorage.setItem('mioStatoDND', mioStatoAttuale); 
        socket.emit('cambia_stato', mioStatoAttuale);
        this.aggiornaBottoneStatoDND();
        if(typeof app.aggiornaGraficaRadar === 'function') app.aggiornaGraficaRadar();
    },

    apriMiniProfilo(nome, immagine, bio, ruolo, eta, roomId) {
        const elNome = document.getElementById('mini-profilo-nome');
        const elImg = document.getElementById('mini-profilo-img');
        const elEta = document.getElementById('mini-profilo-eta');
        const elBio = document.getElementById('mini-profilo-bio');
        const tag = document.getElementById('mini-profilo-ruolo-tag');
        const testoRuolo = document.getElementById('mini-profilo-ruolo-testo');
        const pallino = document.getElementById('mini-profilo-pallino');

        if(elNome) elNome.innerText = nome;
        if(elImg) elImg.src = immagine;
        if(elEta) elEta.innerText = eta || '--';
        
        if(elBio) {
            const bioText = (bio && bio !== 'null' && bio !== 'undefined' && bio.trim() !== '') ? bio : "Nessuna biografia disponibile.";
            elBio.innerText = bioText;
        }

        const roleLabels = {
            ADMIN: { badge: 'Admin 🛡️', text: 'Amministratore' },
            COACH: { badge: 'Coach 📋', text: 'Istruttore tecnico' },
            PARTNER: { badge: 'Iscritto', text: 'Atleta' }
        };
        const roleData = roleLabels[ruolo] || roleLabels.PARTNER;
        if (tag) {
            const badge = this.creaBadgeRuoloChat(ruolo || 'PARTNER');
            badge.textContent = roleData.badge;
            tag.replaceChildren(badge);
        }
        if (testoRuolo) testoRuolo.innerText = roleData.text;

        if (pallino) {
            if (roomId && roomId.startsWith('private_')) {
                const otherId = roomId.replace('private_', '').replace(window.app.mioId, '').replace('_', '');
                pallino.style.setProperty('--presence-color', this.getColorePallino(otherId));
                pallino.style.display = 'block';
            } else pallino.style.display = 'none'; 
        }

        if(typeof this.apriModale === 'function') this.apriModale('modale-mini-profilo');
    }
});
