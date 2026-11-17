// Frontend chat: invia messaggi e allegati e costruisce i fumetti, i contatti e i profili rapidi.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
window.app = window.app || {};

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {

    // inviiDaConfermare: Messaggi locali in attesa della conferma del server.
    inviiDaConfermare: new Map(),
    // invioMessaggioInCorso: Stato che impedisce l’invio ripetuto mentre la richiesta precedente è in corso.
    invioMessaggioInCorso: false,

    // inviaMessaggio: Invia il messaggio con identificatore client e attende l’esito, evitando invii duplicati
    // nell’interfaccia.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async inviaMessaggio() {
        // input: Elemento DOM input-messaggio: Campo di input.
        const input = document.getElementById('input-messaggio');
        if (!input || this.invioMessaggioInCorso) return;
        // bozza: Valore della proprietà input.value, conservato per le operazioni successive.
        const bozza = input.value;
        // testo: Testo normalizzato o preparato per la rappresentazione corrente.
        const testo = input.value.trim();
        this.aggiornaComposerChat?.();
        if (testo === '') return;
        
        if (!socket.connected) {
            if (typeof app.mostraNotifica === 'function') app.mostraNotifica("Chat non connessa. Attendi qualche secondo.", "warning");
            this.aggiornaComposerChat?.();
            return;
        }

        // room: Identificativo della stanza su cui opera questo blocco.
        const room = window.stanzaAttuale;
        // precedente: Valore recuperato dalla raccolta indicizzata mediante la chiave.
        const precedente = this.inviiDaConfermare.get(room);
        // clientId: Identificatore del messaggio del client, usato per riconoscere gli invii ripetuti.
        const clientId = precedente?.testo === testo ? precedente.clientId : crypto.randomUUID();
        this.inviiDaConfermare.set(room, { testo, clientId });
        this.invioMessaggioInCorso = true;
        try {
            // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            const result = await socket.timeout(7000).emitWithAck('send_message', { room, contenuto: testo, client_id: clientId });
            if (!result?.ok) throw new Error(result?.errore || 'Invio non confermato.');
            this.inviiDaConfermare.delete(room);
            if (window.stanzaAttuale === room && input.value === bozza) input.value = '';
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this.mostraNotifica?.(error.message === 'operation has timed out'
                ? 'Invio non confermato. Puoi riprovare con lo stesso testo.'
                : error.message, 'warning');
        } finally {
            this.invioMessaggioInCorso = false;
            this.aggiornaComposerChat?.();
        }
    },

    // eliminaMessaggio: Richiede la cancellazione del messaggio identificato tramite l’evento Socket.IO previsto.
    // Riceve: idMessaggio (id del messaggio da eliminare).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async eliminaMessaggio(idMessaggio) {
        // confirmed: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const confirmed = await this.confermaAzione({
            titolo: 'Eliminare il messaggio?',
            messaggio: 'Il messaggio verrà rimosso dalla chat per tutti.',
            testoConferma: 'Elimina messaggio',
            tipo: 'danger'
        });
        if (confirmed) socket.emit('delete_message', idMessaggio);
    },

    // caricaFileChat: Carica il file selezionato nella stanza e ne invia il riferimento firmato insieme al messaggio.
    // Riceve: event (evento del browser).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaFileChat(event) {
        // file: Valore della proprietà event.target.files.0, conservato per le operazioni successive.
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

        // formData: Contenitore multipart per campi del form e file binari.
        const formData = new FormData();
        formData.append('file_chat', file);
        // attachButton: Elemento DOM btn-allega-chat: Allega un file.
        const attachButton = document.getElementById('btn-allega-chat');
        attachButton?.classList.add('is-uploading');
        if (attachButton) attachButton.disabled = true;

        try {
            if (typeof this.mostraNotifica === 'function') this.mostraNotifica("Caricamento file in corso...", "info");
            // uploadUrl: Endpoint dell’upload con la stanza corrente codificata nei parametri.
            const uploadUrl = `/api/chat/upload?room=${encodeURIComponent(window.stanzaAttuale || '')}`;
            // risultato: Esito della richiesta al backend utilizzato per aggiornare l’interfaccia.
            const risultato = await this.apiRequest(uploadUrl, {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
                method: 'POST',
                body: formData,
                // timeout: Tempo massimo dell’operazione espresso in millisecondi.
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
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
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
    // allegatoSrc: Costruisce l’indirizzo dell’allegato usando l’endpoint protetto associato al messaggio.
    // Riceve: messaggio (dati o testo del messaggio).
    allegatoSrc(messaggio) {
        // id: Valore convertito o normalizzato prima del suo utilizzo.
        const id = Number(messaggio?.id);
        return Number.isSafeInteger(id) && id > 0 && messaggio.file_url ? '/api/chat/allegati/' + id : '';
    },

    // creaAllegatoMessaggio: Costruisce l’elemento DOM adatto al tipo di allegato ricevuto.
    // Riceve: messaggio (dati o testo del messaggio).
    creaAllegatoMessaggio(messaggio) {
        // fileUrl: Riferimento al file allegato da presentare o trasmettere.
        const fileUrl = this.allegatoSrc(messaggio);
        if (!fileUrl) return null;
        // fileType: Tipo MIME dell’allegato usato per scegliere controlli e rappresentazione.
        const fileType = messaggio.file_type || '';
        // isImage: Indicatore booleano che controlla la condizione descritta dal nome.
        const isImage = fileType.startsWith('image/')
            || /\.(jpeg|jpg|gif|png|webp)$/i.test(messaggio.file_url);
        // isAudio: Indicatore booleano che controlla la condizione descritta dal nome.
        const isAudio = fileType.startsWith('audio/')
            || /\.(webm|mp3|wav|ogg|mp4|aac|m4a)$/i.test(messaggio.file_url);

        if (isImage) {
            // image: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const image = this.creaElemento('img', {
                className: 'msg-img-allegata',
                attrs: {
                    src: fileUrl,
                    alt: 'Immagine allegata al messaggio',
                    loading: 'lazy',
                    decoding: 'async'
                }
            });
            // Esegue l’azione del controllo quando viene premuto. Crea e apre il visualizzatore dell’immagine a schermo
            // esteso.
            image.addEventListener('click', () => this.apriImmagineFullscreen(image.src));
            return image;
        }

        if (isAudio && typeof this.generaPlayerAudio === 'function') {
            return this.generaPlayerAudio(messaggio);
        }

        // nomeFile: Valore della proprietà messaggio.file_url, conservato per le operazioni successive.
        let nomeFile = messaggio.file_url;
        // primoUnderscore: Risultato della chiamata nomeFile.indexOf, riutilizzato nelle istruzioni successive.
        const primoUnderscore = nomeFile.indexOf('_');
        if (primoUnderscore !== -1) nomeFile = nomeFile.substring(primoUnderscore + 1);

        // fileBox: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const fileBox = this.creaElemento('div', { className: 'msg-file-box' });
        // icon: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const icon = this.creaElemento('span', {
            className: 'msg-file-icon',
            text: '📄'
        });
        // details: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const details = this.creaElemento('div', { className: 'msg-file-details' });
        // name: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const name = this.creaElemento('div', {
            className: 'msg-file-name',
            text: nomeFile,
            attrs: { title: nomeFile }
        });
        // download: Elemento DOM creato per comporre questa parte dell’interfaccia.
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

    // chatInFondo: Verifica se lo scorrimento è abbastanza vicino alla fine della chat.
    // Riceve: margine (distanza dalla fine tollerata).
    chatInFondo(margine = 120) {
        // contenitore: Elemento DOM contenitore-messaggi: Messaggi della chat.
        const contenitore = document.getElementById('contenitore-messaggi');
        if (!contenitore) return true;
        return contenitore.scrollHeight - contenitore.scrollTop - contenitore.clientHeight <= margine;
    },

    // creaPulsanteFondoChat: Crea il pulsante che permette di tornare agli ultimi messaggi.
    creaPulsanteFondoChat() {
        // esistente: Elemento DOM btn-chat-scroll-bottom: viene letto o aggiornato da questo blocco.
        const esistente = document.getElementById('btn-chat-scroll-bottom');
        if (esistente) return esistente;

        // button: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const button = this.creaElemento('button', {
            className: 'chat-scroll-bottom',
            text: 'Vai agli ultimi messaggi',
            attrs: {
                id: 'btn-chat-scroll-bottom',
                type: 'button'
            }
        });
        // Esegue l’azione del controllo quando viene premuto. Porta il contenitore dei messaggi alla fine con lo
        // scorrimento previsto.
        button.addEventListener('click', () => this.scrollaChatInFondo(true));
        return button;
    },

    // mostraPulsanteFondoChat: Aggiorna la visibilità del pulsante per tornare in fondo alla chat.
    // Riceve: mostra (se mostrare il controllo).
    mostraPulsanteFondoChat(mostra = true) {
        // contenitore: Elemento DOM contenitore-messaggi: Messaggi della chat.
        const contenitore = document.getElementById('contenitore-messaggi');
        if (!contenitore) return;

        // button: Elemento DOM btn-chat-scroll-bottom: viene letto o aggiornato da questo blocco.
        const button = mostra
            ? this.creaPulsanteFondoChat()
            : document.getElementById('btn-chat-scroll-bottom');
        if (!button) return;
        if (mostra || !button.parentElement) contenitore.appendChild(button);
        button.hidden = !mostra;
    },

    // creaStatoVuotoChat: Prepara il messaggio mostrato quando la conversazione non contiene ancora messaggi.
    creaStatoVuotoChat() {
        // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
        const stanza = this.getStanzaChat?.(window.stanzaAttuale);
        // isGeneral: Indicatore booleano che controlla la condizione descritta dal nome.
        const isGeneral = window.stanzaAttuale === 'general';
        // title: Valore scelto tra i due rami in base alla condizione indicata.
        const title = isGeneral ? 'La Piazza principale è pronta' : 'Ancora nessun messaggio';
        // copy: Valore scelto tra i due rami in base alla condizione indicata.
        const copy = isGeneral
            ? 'Apri la conversazione con un saluto, una domanda o un aggiornamento utile.'
            : `Scrivi in ${stanza?.nome || 'questa chat'} e fai partire la conversazione.`;

        // wrapper: Elemento DOM creato per comporre questa parte dell’interfaccia.
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

    // stampaFumetto: Costruisce il fumetto del messaggio con autore, contenuto, allegato e azioni consentite.
    // Riceve: messaggio (dati o testo del messaggio); opzioni (opzioni di rappresentazione).
    stampaFumetto(messaggio, opzioni = {}) {
        // contenitore: Elemento DOM contenitore-messaggi: Messaggi della chat.
        const contenitore = document.getElementById('contenitore-messaggi');
        if (!contenitore || document.getElementById('msg-' + messaggio.id)) return;
        
        // isMioMessaggio: Indicatore booleano che controlla la condizione descritta dal nome.
        const isMioMessaggio = (messaggio.user_id === window.app.mioId);
        // restaInFondo: Ricorda se mantenere la chat sugli ultimi messaggi dopo l’aggiornamento.
        const restaInFondo = !opzioni.skipScroll && (opzioni.forceScroll === true || isMioMessaggio || this.chatInFondo());
        contenitore.querySelector('.chat-empty-state')?.remove();
        contenitore.querySelector('.chat-list-state')?.remove();

        // avatar: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const avatar = this.creaElemento('img', {
            className: 'msg-avatar',
            attrs: {
                src: this.uploadSrc(messaggio.propic),
                alt: `Foto di ${messaggio.nome || ''} ${messaggio.cognome || ''}`.trim(),
                loading: 'lazy',
                decoding: 'async'
            }
        });
        // riga: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const riga = this.creaElemento('div', {
            className: `msg-row ${isMioMessaggio ? 'mio' : 'altro'}`
        });
        riga.id = `msg-${messaggio.id}`;
        // orario: Orario formattato per l’interfaccia.
        const orario = new Date(messaggio.data_invio).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        // bubble: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const bubble = this.creaElemento('div', {
            className: `msg-bubble ${isMioMessaggio ? 'mio' : 'altro'}`
        });

        if (!isMioMessaggio) {
            bubble.appendChild(this.creaElemento('div', {
                className: 'msg-mittente',
                text: `${messaggio.nome || ''} ${messaggio.cognome || ''}`.trim()
            }));
        }

        // attachment: Risultato di creaAllegatoMessaggio. Costruisce l’elemento DOM adatto al tipo di allegato ricevuto.
        const attachment = this.creaAllegatoMessaggio(messaggio);
        if (attachment) bubble.appendChild(attachment);

        if (messaggio.contenuto) {
            bubble.appendChild(this.creaElemento('div', {
                className: 'msg-testo',
                text: messaggio.contenuto
            }));
        }

        // info: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const info = this.creaElemento('div', { className: 'msg-info' });
        info.appendChild(this.creaElemento('span', { text: orario }));
        // ruoloSicuro: Valore scelto tra i due rami in base alla condizione indicata.
        const ruoloSicuro = (typeof mioRuoloChat !== 'undefined') ? mioRuoloChat : (window.app.mioRuolo || '');
        // stanzaMessaggio: Risultato di getStanzaChat. Trova i dati della stanza usando il suo identificativo.
        const stanzaMessaggio = this.getStanzaChat?.(messaggio.room || window.stanzaAttuale);
        // puoEliminareMessaggi: Permesso indicato al frontend per mostrare l’azione di moderazione.
        const puoEliminareMessaggi = stanzaMessaggio?.can_delete_messages === true || (!stanzaMessaggio && ruoloSicuro === 'ADMIN');
        if (puoEliminareMessaggi) {
            // deleteButton: Elemento DOM creato per comporre questa parte dell’interfaccia.
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
                attrs: { src: 'uploads/buttons/tasto_cestino.svg', alt: '' }
            }));
            // Esegue l’azione del controllo quando viene premuto. Richiede la cancellazione del messaggio identificato tramite
            // l’evento Socket.IO previsto.
            deleteButton.addEventListener('click', () => this.eliminaMessaggio(messaggio.id));
            info.appendChild(deleteButton);
        }

        bubble.appendChild(info);
        if (isMioMessaggio) riga.append(bubble, avatar);
        else riga.append(avatar, bubble);
        (opzioni.target || contenitore).appendChild(riga);
        if (opzioni.skipScroll) return;
        if (restaInFondo) this.scrollaChatInFondo(opzioni.immediato === true);
        else this.mostraPulsanteFondoChat(true);
    },


    // scrollaChatInFondo: Porta il contenitore dei messaggi alla fine con lo scorrimento previsto.
    // Riceve: immediato (se saltare l’animazione).
    scrollaChatInFondo(immediato = false) {
        // contenitore: Elemento DOM contenitore-messaggi: Messaggi della chat.
        const contenitore = document.getElementById('contenitore-messaggi');
        if (!contenitore) return;

        // scorri: Applica lo spostamento del contenitore alla fine del contenuto della chat.
        const scorri = () => {
            contenitore.scrollTop = contenitore.scrollHeight;
            this.mostraPulsanteFondoChat(false);
        };

        if (immediato) scorri();
        else setTimeout(scorri, 100);
    },

    // creaBadgeRuoloChat: Crea l’etichetta DOM del ruolo con l’aspetto compatto richiesto.
    // Riceve: ruolo (ruolo applicativo); compact (modalità compatta).
    creaBadgeRuoloChat(ruolo, compact = false) {
        // labels: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const labels = {
            ADMIN: 'ADMIN',
            COACH: 'COACH',
            PARTNER: 'Iscritto'
        };
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (!labels[ruolo]) return null;

        return this.creaElemento('span', {
            className: `role-badge role-badge-${ruolo.toLowerCase()}${compact ? ' is-compact' : ''}`,
            text: labels[ruolo]
        });
    },

    // creaPallinoStato: Crea l’indicatore di presenza associato a un utente.
    // Riceve: userId (id dell’utente); className (classi CSS da applicare).
    creaPallinoStato(userId, className = 'pallino-stato') {
        // dot: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const dot = this.creaElemento('span', {
            className,
            attrs: { 'data-id': userId, 'aria-hidden': 'true' }
        });
        dot.style.setProperty('--presence-color', this.getColorePallino(userId));
        return dot;
    },

    // creaContattoElemento: Costruisce la voce di contatto selezionabile per una conversazione privata.
    // Riceve: contatto (dati del contatto).
    creaContattoElemento(contatto) {
        // item: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const item = this.creaElemento('button', {
            className: 'contatto-item',
            attrs: { type: 'button' }
        });
        // avatarWrapper: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const avatarWrapper = this.creaElemento('span', { className: 'contact-avatar-wrap' });
        // avatar: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const avatar = this.creaElemento('img', {
            className: 'contact-avatar',
            attrs: {
                src: this.uploadSrc(contatto.propic),
                alt: `Foto di ${contatto.nome || ''} ${contatto.cognome || ''}`.trim(),
                loading: 'lazy'
            }
        });
        avatarWrapper.append(avatar, this.creaPallinoStato(contatto.id));

        // content: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const content = this.creaElemento('span', { className: 'contact-content' });
        // name: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const name = this.creaElemento('span', {
            className: 'nome-contatto',
            text: `${contatto.nome || ''} ${contatto.cognome || ''}`.trim()
        });
        if (contatto.ruolo === 'ADMIN' || contatto.ruolo === 'COACH') {
            name.appendChild(this.creaBadgeRuoloChat(contatto.ruolo, true));
        }
        content.appendChild(name);

        // chatIcon: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const chatIcon = this.creaElemento('span', {
            className: 'contact-chat-icon',
            text: '💬',
            attrs: { 'aria-hidden': 'true' }
        });
        item.append(avatarWrapper, content, chatIcon);
        // Esegue l’azione del controllo quando viene premuto. Prepara il riferimento alla conversazione privata e passa
        // alla stanza del contatto scelto.
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

    // mostraStatoListaContatti: Mostra nella lista contatti un messaggio di caricamento, errore o assenza di
    // risultati.
    // Riceve: container (contenitore del DOM); message (testo del messaggio); type (tipo previsto).
    mostraStatoListaContatti(container, message, type = '') {
        if (!container) return;
        container.replaceChildren(this.creaElemento('p', {
            className: `chat-list-state${type ? ` is-${type}` : ''}`,
            text: message
        }));
    },

    // apriModaleContatti: Apre la ricerca dei contatti e carica gli utenti disponibili.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async apriModaleContatti() {
        if(typeof this.apriModale === 'function') this.apriModale('modale-contatti');
        // contenitore: Elemento DOM lista-contatti: Contenitore dell’interfaccia.
        const contenitore = document.getElementById('lista-contatti');
        this.mostraStatoListaContatti(contenitore, 'Ricerca contatti...');
        // barraRicerca: Elemento DOM input-cerca-contatti: Campo di input.
        const barraRicerca = document.getElementById('input-cerca-contatti'); if (barraRicerca) barraRicerca.value = '';

        try {
            // contatti: Risultato della richiesta HTTP attesa prima di proseguire.
            const contatti = await this.apiRequest('/api/chat/contatti');
            if (contatti.length === 0) {
                this.mostraStatoListaContatti(contenitore, 'Nessun contatto disponibile.');
                return;
            }

            // fragment: Frammento DOM che raccoglie i nodi prima del loro inserimento nel documento.
            const fragment = document.createDocumentFragment();
            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: contatto (dati del contatto).
            contatti.forEach(contatto => fragment.appendChild(this.creaContattoElemento(contatto)));
            contenitore.replaceChildren(fragment);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this.mostraStatoListaContatti(
                contenitore,
                this.apiErrorMessage(error, 'Errore di caricamento.'),
                'error'
            );
        }
    },

    // filtraContatti: Mostra soltanto i contatti che corrispondono alla ricerca corrente.
    filtraContatti() {
        // input: Elemento DOM input-cerca-contatti: Campo di input.
        const input = document.getElementById('input-cerca-contatti'); if(!input) return;
        // val: Risultato della chiamata input.value.toLowerCase, riutilizzato nelle istruzioni successive.
        const val = input.value.toLowerCase();
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: contatto (dati del contatto).
        document.querySelectorAll('.contatto-item').forEach(contatto => {
            // nomeEl: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
            const nomeEl = contatto.querySelector('.nome-contatto');
            if (nomeEl) contatto.hidden = !nomeEl.textContent.toLowerCase().includes(val);
        });
    },

    // avviaChatPrivata: Prepara il riferimento alla conversazione privata e passa alla stanza del contatto scelto.
    // Riceve: altroId (id dell’altro utente); altroNome (nome dell’altro utente); propic (immagine del profilo); ruolo
    // (ruolo applicativo).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async avviaChatPrivata(altroId, altroNome, propic = '', ruolo = '') {
        // room_id: Nome della stanza chat usato dagli eventi Socket.IO.
        let room_id;
        try {
            // result: Risultato della richiesta HTTP attesa prima di proseguire.
            // method: Metodo HTTP che identifica l’operazione richiesta al backend.
            const result = await this.apiRequest('/api/chat/private/' + encodeURIComponent(altroId), { method: 'POST' });
            room_id = result.room;
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this.mostraNotifica?.(this.apiErrorMessage(error, 'Impossibile aprire la conversazione.'), 'warning');
            return;
        }
        this.chiudiModale?.('modale-contatti');

        if (!document.getElementById(`nav-room-${room_id}`)) {
            // lista: Elemento DOM lista-stanze-chat: Elemento della pagina.
            const lista = document.getElementById('lista-stanze-chat');
            if (!this.stanzeChatById) this.stanzeChatById = new Map();
            // datiStanza: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
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
            // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
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

    // getColorePallino: Ricava il colore dell’indicatore in base a presenza e stato personale dell’utente.
    // Riceve: userId (id dell’utente).
    getColorePallino(userId) {
        if (!radarUtentiOnline.has(Number(userId))) return '#dfe4ea'; 
        return radarUtentiOnline.get(Number(userId)) === 'DND' ? '#ff4757' : '#2ed573'; 
    },
    
    // aggiornaGraficaRadar: Aggiorna gli indicatori di presenza già visibili nel DOM.
    aggiornaGraficaRadar() {
        // pallini: Elementi DOM individuati dal selettore per aggiornare questo gruppo di controlli.
        const pallini = document.querySelectorAll('.pallino-stato, .pallino-stato-chat');
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: p (indicatore di presenza).
        pallini.forEach(p => {
            // idContatto: Valore convertito o normalizzato prima del suo utilizzo.
            const idContatto = Number(p.dataset.id);
            p.style.setProperty('--presence-color', this.getColorePallino(idContatto));
        });
    },

    // aggiornaBottoneStatoDND: Allinea il pulsante alla preferenza personale online o non disturbare.
    aggiornaBottoneStatoDND() {
        // button: Elemento DOM btn-stato-dnd: Pulsante del controllo.
        const button = document.getElementById('btn-stato-dnd');
        if (!button) return;
        // isDnd: Indicatore booleano che controlla la condizione descritta dal nome.
        const isDnd = mioStatoAttuale === 'DND';
        button.textContent = isDnd ? '🔴 Stato: non disturbare' : '🟢 Stato: disponibile';
        button.classList.toggle('is-dnd', isDnd);
        button.classList.toggle('is-online', !isDnd);
    },
    
    // toggleStatoDND: Cambia la preferenza non disturbare e la comunica al server.
    toggleStatoDND() {
        mioStatoAttuale = (mioStatoAttuale === 'ONLINE') ? 'DND' : 'ONLINE';
        localStorage.setItem('mioStatoDND', mioStatoAttuale); 
        socket.emit('cambia_stato', mioStatoAttuale);
        this.aggiornaBottoneStatoDND();
        if(typeof app.aggiornaGraficaRadar === 'function') app.aggiornaGraficaRadar();
    },

    // apriMiniProfilo: Mostra i dati del profilo rapido e le azioni disponibili per quella persona.
    // Riceve: nome (nome della persona); immagine (indirizzo dell’immagine); bio (descrizione della persona); ruolo
    // (ruolo applicativo); eta (età della persona); roomId (id della stanza).
    apriMiniProfilo(nome, immagine, bio, ruolo, eta, roomId) {
        // elNome: Elemento DOM mini-profilo-nome: Titolo della sezione.
        const elNome = document.getElementById('mini-profilo-nome');
        // elImg: Elemento DOM mini-profilo-img: Immagine dell’interfaccia.
        const elImg = document.getElementById('mini-profilo-img');
        // elEta: Elemento DOM mini-profilo-eta: Etichetta o indicatore dell’interfaccia.
        const elEta = document.getElementById('mini-profilo-eta');
        // elBio: Elemento DOM mini-profilo-bio: Testo informativo.
        const elBio = document.getElementById('mini-profilo-bio');
        // tag: Elemento DOM mini-profilo-ruolo-tag: Contenitore dell’interfaccia.
        const tag = document.getElementById('mini-profilo-ruolo-tag');
        // testoRuolo: Elemento DOM mini-profilo-ruolo-testo: Etichetta o indicatore dell’interfaccia.
        const testoRuolo = document.getElementById('mini-profilo-ruolo-testo');
        // pallino: Elemento DOM mini-profilo-pallino: Etichetta o indicatore dell’interfaccia.
        const pallino = document.getElementById('mini-profilo-pallino');

        if(elNome) elNome.innerText = nome;
        if(elImg) elImg.src = immagine;
        if(elEta) elEta.innerText = eta || '--';
        
        if(elBio) {
            // bioText: Valore scelto tra i due rami in base alla condizione indicata.
            const bioText = (bio && bio !== 'null' && bio !== 'undefined' && bio.trim() !== '') ? bio : "Nessuna biografia disponibile.";
            elBio.innerText = bioText;
        }

        // roleLabels: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const roleLabels = {
            ADMIN: { badge: 'Admin 🛡️', text: 'Amministratore' },
            COACH: { badge: 'Coach 📋', text: 'Istruttore tecnico' },
            PARTNER: { badge: 'Iscritto', text: 'Atleta' }
        };
        // roleData: Dati grafici ed etichetta del ruolo da rappresentare nel badge.
        const roleData = roleLabels[ruolo] || roleLabels.PARTNER;
        if (tag) {
            // badge: Risultato di creaBadgeRuoloChat. Crea l’etichetta DOM del ruolo con l’aspetto compatto richiesto.
            const badge = this.creaBadgeRuoloChat(ruolo || 'PARTNER');
            badge.textContent = roleData.badge;
            tag.replaceChildren(badge);
        }
        if (testoRuolo) testoRuolo.innerText = roleData.text;

        if (pallino) {
            if (roomId && roomId.startsWith('private_')) {
                // otherId: Risultato della chiamata roomId.replace.replace.replace, riutilizzato nelle istruzioni successive.
                const otherId = roomId.replace('private_', '').replace(window.app.mioId, '').replace('_', '');
                pallino.style.setProperty('--presence-color', this.getColorePallino(otherId));
                pallino.style.display = 'block';
            } else pallino.style.display = 'none'; 
        }

        if(typeof this.apriModale === 'function') this.apriModale('modale-mini-profilo');
    }
});
