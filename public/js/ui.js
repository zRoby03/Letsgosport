// Frontend: costruisce cataloghi e schede, cambia sezione e gestisce modali, conferme e notifiche visive.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
window.app = window.app || {};
// indirizziPagine: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
const indirizziPagine = {
    home: 'home', dashboard: 'corsi', gare: 'gare', chat: 'chat',
    profilo: 'area', admin: 'admin', coach: 'coach'
};

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {

    // caricaAnteprimaHome: Carica le informazioni sintetiche di corsi e gare da mostrare nella home.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaAnteprimaHome() {
        // corsi: Elemento DOM home-corsi: Contenitore dell’interfaccia.
        const corsi = document.getElementById('home-corsi');
        // gare: Elemento DOM home-gare: Contenitore dell’interfaccia.
        const gare = document.getElementById('home-gare');
        // corsiResult: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        // gareResult: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const [corsiResult, gareResult] = await Promise.allSettled([
            this.apiRequest('/api/corsi'),
            this.apiRequest('/api/gare')
        ]);
        // stato: Mostra un messaggio di stato nell’elemento indicato.
        // Riceve: element (elemento del DOM); message (testo del messaggio).
        const stato = (element, message) => element.replaceChildren(this.creaElemento('p', { text: message }));
        // creaVoce: Costruisce una voce dell’anteprima home e collega la navigazione alla sezione richiesta.
        // Riceve: page (metadati della pagina ricevuta); children (nodi da inserire nel nuovo elemento).
        const creaVoce = (page, ...children) => {
            // button: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const button = this.creaElemento('button', { attrs: { type: 'button' } });
            button.append(...children);
            // Esegue l’azione del controllo quando viene premuto. Cambia sezione visibile, aggiorna navigazione e indirizzo
            // quando richiesto.
            button.addEventListener('click', () => this.naviga(page));
            return button;
        };
        if (corsi && corsiResult.status === 'fulfilled' && Array.isArray(corsiResult.value)) {
            // cards: Elenco ottenuto trasformando gli elementi della raccolta di partenza.
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: corso (dati del corso).
            const cards = corsiResult.value.slice(0, 8).map(corso => {
                // visual: Icona, categoria e tono grafico scelti per la scheda del catalogo.
                const visual = this.getCourseVisual(corso.nome || '');
                return creaVoce('dashboard',
                    this.creaElemento('span', { className: 'sport-icon sport-icon-' + visual.tone, text: visual.icon }),
                    this.creaElemento('strong', { text: corso.nome }),
                    this.creaElemento('small', { text: corso.bio || '' }),
                    this.creaElemento('span', { text: '›', attrs: { 'aria-hidden': 'true' } })
                );
            });
            if (cards.length) corsi.replaceChildren(...cards);
            else stato(corsi, 'Nessun corso disponibile al momento.');
        } else if (corsi) {
            stato(corsi, 'I corsi sono momentaneamente non disponibili.');
        }

        if (gare && gareResult.status === 'fulfilled' && Array.isArray(gareResult.value)) {
            // parts: Risultato della chiamata .formatToParts, riutilizzato nelle istruzioni successive.
            const parts = new Intl.DateTimeFormat('it-IT', {
                timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }).formatToParts(new Date());
            // now: Istante attuale in millisecondi usato per scadenze e durate.
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: type (tipo previsto); value (valore da elaborare).
            const now = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
            // cutoff: Istante limite prima del quale le registrazioni sono considerate scadute.
            const cutoff = [now.year, now.month, now.day].join('-') + ' ' + now.hour + ':' + now.minute;
            // future: Risultato della chiamata gareResult.value.filter.slice, riutilizzato nelle istruzioni successive.
            // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
            // Riceve: gara (dati della gara).
            const future = gareResult.value.filter(gara =>
                /^\d{4}-\d{2}-\d{2}$/.test(gara.giorno || '') &&
                gara.giorno + ' ' + (gara.orario?.slice(0, 5) || '23:59') >= cutoff
            ).slice(0, 3);
            // cards: Elenco ottenuto trasformando gli elementi della raccolta di partenza.
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: gara (dati della gara).
            const cards = future.map(gara => {
                // date: Oggetto Date usato per controllare o rappresentare un riferimento temporale.
                const date = new Date(gara.giorno + 'T12:00:00');
                // chip: Elemento DOM creato per comporre questa parte dell’interfaccia.
                const chip = this.creaElemento('span', { className: 'date-chip' });
                chip.append(
                    this.creaElemento('strong', { text: gara.giorno.slice(8) }),
                    this.creaElemento('small', { text: date.toLocaleDateString('it-IT', { month: 'short' }) })
                );
                return creaVoce('gare', chip,
                    this.creaElemento('strong', { text: gara.nome }),
                    this.creaElemento('small', { text: gara.bio || '' }),
                    this.creaElemento('time', { text: gara.orario?.slice(0, 5) || '', attrs: { datetime: gara.giorno } }),
                    this.creaElemento('span', { text: 'Vai alle gare' })
                );
            });
            if (cards.length) gare.replaceChildren(...cards);
            else stato(gare, 'Nessuna gara in programma al momento.');
        } else if (gare) {
            stato(gare, 'Le gare sono momentaneamente non disponibili.');
        }
    },
    
    // navigaDaIndirizzo: Legge il riferimento nell’indirizzo del browser e apre la sezione corrispondente.
    navigaDaIndirizzo() {
        // hash: Risultato della chiamata window.location.hash.slice, riutilizzato nelle istruzioni successive.
        const hash = window.location.hash.slice(1);
        // pagina: Sezione o riferimento della pagina su cui opera la navigazione.
        // Restituisce il criterio per individuare il primo elemento corrispondente.
        // Riceve: key (chiave della raccolta).
        const pagina = Object.keys(indirizziPagine).find(key => indirizziPagine[key] === hash) || 'home';
        if (!this.naviga(pagina, { aggiornaIndirizzo: false })) {
            this.naviga('home', { aggiornaIndirizzo: false });
        }
    },

    // naviga: Cambia sezione visibile, aggiorna navigazione e indirizzo quando richiesto.
    // Riceve: idPagina (id della sezione da mostrare); aggiornaIndirizzo (se aggiornare il riferimento
    // nell’indirizzo).
    naviga(idPagina, { aggiornaIndirizzo = true } = {}) {
        if (idPagina === 'chat' && !window.app.mioId) {
            this.mostraNotifica?.('Accedi per usare la chat.', 'warning');
            this.apriModale?.('modale-login');
            return;
        }
        if (idPagina === 'profilo' && !window.app.mioId) {
            this.mostraNotifica?.('Accedi per aprire la tua area personale.', 'warning');
            this.apriModale?.('modale-login');
            return;
        }
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (idPagina === 'admin' && window.app.utenteCorrente?.ruolo !== 'ADMIN') {
            this.mostraNotifica?.('Area riservata agli amministratori.', 'warning');
            return;
        }
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (idPagina === 'coach' && window.app.utenteCorrente?.ruolo !== 'COACH') {
            this.mostraNotifica?.('Area riservata ai coach.', 'warning');
            return;
        }

        // sezioneScelta: Elemento DOM pagina-: viene letto o aggiornato da questo blocco.
        const sezioneScelta = document.getElementById('pagina-' + idPagina);
        if (!sezioneScelta || !indirizziPagine[idPagina]) return false;
        // hash: Risultato del calcolo o del controllo applicato ai valori del blocco.
        const hash = '#' + indirizziPagine[idPagina];
        if (aggiornaIndirizzo && window.location.hash !== hash) history.pushState(null, '', hash);
        // sezioni: Elementi DOM individuati dal selettore per aggiornare questo gruppo di controlli.
        const sezioni = document.querySelectorAll('.sezione-pagina');
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: sezione (sezione DOM della pagina).
        sezioni.forEach(sezione => sezione.classList.add('hidden'));

        sezioneScelta.classList.remove('hidden');

        // navMap: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const navMap = {
            home: ['btn-home'],
            dashboard: ['btn-dashboard'],
            gare: ['btn-gare'],
            chat: ['btn-chat'],
            profilo: ['btn-profilo', 'btn-area-mobile'],
            admin: ['btn-admin'],
            coach: ['btn-coach']
        };
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: button (pulsante da configurare).
        document.querySelectorAll('.navbar button').forEach(button => {
            button.classList.remove('is-active');
            button.removeAttribute('aria-current');
        });
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: buttonId (id del pulsante).
        (navMap[idPagina] || []).forEach(buttonId => {
            // activeButton: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
            const activeButton = document.getElementById(buttonId);
            if (!activeButton) return;
            activeButton.classList.add('is-active');
            activeButton.setAttribute('aria-current', 'page');
        });

        document.body.classList.toggle('chat-page-active', idPagina === 'chat');
        document.body.dataset.currentPage = idPagina;
        if (idPagina !== 'chat') this.fermaRegistrazioneVocale?.(true);
        else {
            window.scrollTo(0, 0);
            window.aggiornaAltezzaViewport?.();
        }
        if (typeof this.chiudiMenuMobile === 'function') {
            this.chiudiMenuMobile();
        }
        if (idPagina !== 'chat' && typeof this.chiudiPannelloChatMobile === 'function') {
            this.chiudiPannelloChatMobile();
            document.body.classList.remove('chat-conversation-open', 'chat-private-active');
        }

        if (idPagina === 'dashboard') this.caricaCorsi();
        if (idPagina === 'profilo' && typeof this.caricaProfilo === 'function') this.caricaProfilo();
        if (idPagina === 'gare') this.caricaGare();
        
        if (idPagina === 'admin') {
            if(typeof this.caricaGestioneUtenti === 'function') this.caricaGestioneUtenti();
            if(typeof this.caricaTendinaCoaches === 'function') this.caricaTendinaCoaches();
            if(typeof this.caricaAdminCorsi === 'function') this.caricaAdminCorsi();
            if(typeof this.caricaAdminGare === 'function') this.caricaAdminGare();
        }
        
        if (idPagina === 'coach' && typeof this.caricaAreaCoach === 'function') this.caricaAreaCoach();
        
        if (idPagina === 'chat') {
            if (this.isMobileLayout?.() && typeof this.mostraListaChatMobile === 'function') {
                this.mostraListaChatMobile();
            }
            if(typeof this.caricaStanzeChat === 'function') this.caricaStanzeChat();
            if (!this.isMobileLayout?.() && typeof this.cambiaStanzaChat === 'function') {
                this.cambiaStanzaChat(window.stanzaAttuale || 'general');
            }
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            setTimeout(() => { if(typeof this.scrollaChatInFondo === 'function') this.scrollaChatInFondo(); }, 300);
        }
        return true;
    },

    // mostraNotifica: Crea una notifica temporanea nell’interfaccia e ne gestisce la rimozione.
    // Riceve: messaggio (dati o testo del messaggio); tipo (tipo di visualizzazione).
    mostraNotifica(messaggio, tipo = 'success') {
        // container: Elemento DOM toast-container: Contenitore dell’interfaccia.
        const container = document.getElementById('toast-container');
        if (!container) return;

        // toast: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const toast = this.creaElemento('div', { className: `toast ${tipo}` });
        toast.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', tipo === 'error' ? 'assertive' : 'polite');

        // icone: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const icone = { success: 'OK', error: '!', warning: '!', info: 'i' };
        // icona: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const icona = this.creaElemento('span', {
            className: 'toast-icon',
            text: icone[tipo] || 'i',
            attrs: { 'aria-hidden': 'true' }
        });

        // testo: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const testo = this.creaElemento('span', {
            className: 'toast-message',
            text: messaggio ?? ''
        });

        toast.replaceChildren(icona, testo);

        container.appendChild(toast);
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        setTimeout(() => toast.classList.add('show'), 10);
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        setTimeout(() => {
            toast.classList.remove('show');
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            setTimeout(() => toast.remove(), 300); 
        }, 3000);
    },

    // confermaAzione: Mostra una conferma accessibile e restituisce una Promise con la scelta dell’utente.
    // Riceve: titolo (titolo della conferma); messaggio (dati o testo del messaggio); testoConferma (testo del
    // pulsante di conferma); testoAnnulla (testo del pulsante di annullamento); tipo (tipo di visualizzazione).
    // Restituisce una Promise con true per conferma o false per annullamento.
    confermaAzione({
        titolo = 'Conferma azione',
        messaggio = 'Vuoi continuare?',
        testoConferma = 'Conferma',
        testoAnnulla = 'Annulla',
        tipo = 'warning'
    } = {}) {
        // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
        // Riceve: resolve (completa la Promise con successo).
        return new Promise((resolve) => {
            document.getElementById('modale-conferma-app')?.remove();

            // overlay: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const overlay = this.creaElemento('div', {
                className: 'modal-overlay app-confirm-overlay active',
                attrs: {
                    id: 'modale-conferma-app',
                    role: 'dialog',
                    'aria-modal': 'true',
                    'aria-labelledby': 'titolo-conferma-app'
                }
            });

            // dialog: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const dialog = this.creaElemento('div', { className: `app-confirm-dialog is-${tipo}` });
            // icon: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const icon = this.creaElemento('span', {
                className: 'app-confirm-icon',
                text: tipo === 'danger' ? '!' : '?',
                attrs: { 'aria-hidden': 'true' }
            });
            // title: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const title = this.creaElemento('h2', {
                text: titolo,
                attrs: { id: 'titolo-conferma-app' }
            });
            // message: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const message = this.creaElemento('p', { text: messaggio });
            // actions: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const actions = this.creaElemento('div', { className: 'app-confirm-actions' });
            // cancelButton: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const cancelButton = this.creaElemento('button', {
                className: 'app-confirm-cancel',
                text: testoAnnulla,
                attrs: { type: 'button' }
            });
            // confirmButton: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const confirmButton = this.creaElemento('button', {
                className: `app-confirm-submit is-${tipo}`,
                text: testoConferma,
                attrs: { type: 'button' }
            });

            // closed: Promise che permette di attendere la chiusura dello stream prima della pulizia del temporaneo.
            let closed = false;
            // close: Chiude la conferma, pulisce i gestori temporanei e completa la Promise con la scelta.
            // Riceve: confirmed (scelta confermata dall’utente).
            const close = (confirmed) => {
                if (closed) return;
                closed = true;
                document.removeEventListener('keydown', onKeydown);
                overlay.classList.remove('active');
                // Esegue l’azione alla scadenza del temporizzatore previsto.
                window.setTimeout(() => overlay.remove(), 180);
                resolve(confirmed);
            };

            // onKeydown: Gestisce i tasti della finestra di conferma, compresi chiusura e contenimento del focus.
            // Riceve: event (evento del browser).
            const onKeydown = (event) => {
                if (event.key === 'Escape') close(false);
            };

            // Esegue l’azione del controllo quando viene premuto.
            // Riceve: event (evento del browser).
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) close(false);
            });
            // Esegue l’azione del controllo quando viene premuto. Ferma il monitoraggio della vista, chiude le preferenze e
            // ripristina il focus quando richiesto.
            cancelButton.addEventListener('click', () => close(false));
            // Esegue l’azione del controllo quando viene premuto. Ferma il monitoraggio della vista, chiude le preferenze e
            // ripristina il focus quando richiesto.
            confirmButton.addEventListener('click', () => close(true));
            document.addEventListener('keydown', onKeydown);

            actions.append(cancelButton, confirmButton);
            dialog.append(icon, title, message, actions);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            // initialFocus: Valore scelto tra i due rami in base alla condizione indicata.
            const initialFocus = tipo === 'danger' ? cancelButton : confirmButton;
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            window.setTimeout(() => initialFocus.focus({ preventScroll: true }), 50);
        });
    },

    // apriModale: Apre la modale identificata dall’id e prepara i controlli collegati.
    // Riceve: idModale (id della finestra modale).
    apriModale(idModale) {
        // m: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const m = document.getElementById(idModale);
        if (!m) return;
        m.classList.add('active');
        if (typeof this.preparaRecaptchaModale === 'function') {
            this.preparaRecaptchaModale(idModale);
        }
    },

    // chiudiModale: Nasconde la modale identificata dall’id e ripristina gli stati previsti.
    // Riceve: idModale (id della finestra modale).
    chiudiModale(idModale) {
        // m: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const m = document.getElementById(idModale);
        if (!m) return;
        m.classList.remove('active');
        if (typeof this.resettaRecaptcha === 'function') {
            this.resettaRecaptcha(idModale);
        }
    },

    // apriImmagineFullscreen: Crea e apre il visualizzatore dell’immagine a schermo esteso.
    // Riceve: src (indirizzo della risorsa).
    apriImmagineFullscreen(src) {
        // modale: Elemento DOM modale-immagine-fullscreen: viene letto o aggiornato da questo blocco.
        let modale = document.getElementById('modale-immagine-fullscreen');
        
        if (!modale) {
            modale = document.createElement('div');
            modale.id = 'modale-immagine-fullscreen';
            document.body.appendChild(modale);
            
            // Esegue l’azione del controllo quando viene premuto.
            // Riceve: e (evento del browser).
            modale.addEventListener('click', (e) => {
                if (e.target.id === 'modale-immagine-fullscreen') app.chiudiImmagineFullscreen();
            });
        }
        
        // chiudi: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const chiudi = this.creaElemento('button', {
            className: 'chiudi-fullscreen',
            text: 'x',
            attrs: { type: 'button', 'aria-label': 'Chiudi immagine' }
        });
        // Esegue l’azione del controllo quando viene premuto. Chiude il visualizzatore dell’immagine e ne gestisce la
        // rimozione.
        chiudi.addEventListener('click', () => app.chiudiImmagineFullscreen());

        // immagine: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const immagine = this.creaElemento('img', {
            attrs: { src, alt: 'Immagine allegata', decoding: 'async' }
        });

        modale.replaceChildren(chiudi, immagine);
        
        modale.style.display = 'flex';
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        setTimeout(() => modale.classList.add('active'), 10);
    },

    // chiudiImmagineFullscreen: Chiude il visualizzatore dell’immagine e ne gestisce la rimozione.
    chiudiImmagineFullscreen() {
        // modale: Elemento DOM modale-immagine-fullscreen: viene letto o aggiornato da questo blocco.
        const modale = document.getElementById('modale-immagine-fullscreen');
        if (modale) {
            modale.classList.remove('active');
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            setTimeout(() => modale.style.display = 'none', 300);
        }
    },

    // creaStatoVuotoCatalogo: Costruisce il messaggio DOM per un catalogo senza elementi.
    // Riceve: messaggio (dati o testo del messaggio).
    creaStatoVuotoCatalogo(messaggio) {
        return this.creaElemento('p', {
            className: 'catalog-empty-state',
            text: messaggio
        });
    },

    // creaImmagineCard: Prepara l’immagine della scheda e il ripiego da utilizzare in caso di errore.
    // Riceve: src (indirizzo della risorsa); fallback (valore o messaggio di ripiego); alt (testo alternativo
    // dell’immagine).
    creaImmagineCard(src, fallback, alt) {
        // image: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const image = this.creaElemento('img', {
            className: 'card-img',
            attrs: { src, alt, loading: 'lazy', decoding: 'async' }
        });
        // Gestisce l’errore della risorsa o dell’operazione collegata.
        image.addEventListener('error', () => {
            if (!image.src.endsWith(fallback)) image.src = fallback;
        });
        return image;
    },

    // caricaCorsi: Richiede i corsi al backend e ricostruisce le schede del catalogo.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaCorsi() {
        try {
            // corsi: Risultato della richiesta HTTP attesa prima di proseguire.
            const corsi = await this.apiRequest('/api/corsi');
            // contenitore: Elemento DOM contenitore-corsi: Contenitore dell’interfaccia.
            const contenitore = document.getElementById('contenitore-corsi');
            if (!contenitore) return;
            this.svuotaElemento(contenitore);

            if (corsi.length === 0) {
                contenitore.appendChild(this.creaStatoVuotoCatalogo('Nessun corso disponibile.'));
                return;
            }

            // fragment: Frammento DOM che raccoglie i nodi prima del loro inserimento nel documento.
            const fragment = document.createDocumentFragment();
            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: corso (dati del corso).
            corsi.forEach(corso => fragment.appendChild(this.creaCardCorso(corso)));
            contenitore.appendChild(fragment);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            console.error("Errore caricamento corsi:", error);
            // contenitore: Elemento DOM contenitore-corsi: Contenitore dell’interfaccia.
            const contenitore = document.getElementById('contenitore-corsi');
            contenitore?.replaceChildren(
                this.creaStatoVuotoCatalogo(this.apiErrorMessage(error, 'Errore caricamento corsi.'))
            );
        }
    },

    // caricaGare: Richiede le gare al backend e ricostruisce le schede del catalogo.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaGare() {
        try {
            // gare: Risultato della richiesta HTTP attesa prima di proseguire.
            const gare = await this.apiRequest('/api/gare');
            // contenitore: Elemento DOM contenitore-gare: Contenitore dell’interfaccia.
            const contenitore = document.getElementById('contenitore-gare');
            if (!contenitore) return;
            this.svuotaElemento(contenitore);

            if (gare.length === 0) {
                contenitore.appendChild(this.creaStatoVuotoCatalogo('Nessuna gara in programma.'));
                return;
            }

            // fragment: Frammento DOM che raccoglie i nodi prima del loro inserimento nel documento.
            const fragment = document.createDocumentFragment();
            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: gara (dati della gara).
            gare.forEach(gara => fragment.appendChild(this.creaCardGara(gara)));
            contenitore.appendChild(fragment);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            console.error("Errore caricamento gare:", error);
            // contenitore: Elemento DOM contenitore-gare: Contenitore dell’interfaccia.
            const contenitore = document.getElementById('contenitore-gare');
            contenitore?.replaceChildren(
                this.creaStatoVuotoCatalogo(this.apiErrorMessage(error, 'Errore caricamento gare.'))
            );
        }
    }
});

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {
    // roleLabel: Traduce il ruolo tecnico in una dicitura per l’interfaccia.
    // Riceve: ruolo (ruolo applicativo).
    roleLabel(ruolo) {
        // labels: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const labels = {
            ADMIN: 'Admin',
            COACH: 'Coach',
            PARTNER: 'Iscritto'
        };
        return labels[ruolo] || ruolo || 'Iscritto';
    },

    // formattaOrario: Formatta l’orario ricevuto per la visualizzazione nelle schede.
    // Riceve: value (valore da elaborare).
    formattaOrario(value) {
        if (!value) return '--:--';
        return String(value).slice(0, 5);
    },

    // formattaGiorno: Converte il giorno ricevuto in un testo leggibile oppure usa il ripiego previsto.
    // Riceve: value (valore da elaborare); fallback (valore o messaggio di ripiego).
    formattaGiorno(value, fallback = 'Da definire') {
        // raw: Valore convertito o normalizzato prima del suo utilizzo.
        const raw = String(value || '').trim();
        if (!raw) return fallback;

        // key: Risultato della chiamata raw.toLocaleLowerCase.normalize.replace, riutilizzato nelle istruzioni successive.
        const key = raw
            .toLocaleLowerCase('it-IT')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        // labels: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const labels = {
            lunedi: 'Lunedì',
            martedi: 'Martedì',
            mercoledi: 'Mercoledì',
            giovedi: 'Giovedì',
            venerdi: 'Venerdì',
            sabato: 'Sabato',
            domenica: 'Domenica'
        };
        return labels[key] || raw;
    },

    // getCourseVisual: Sceglie il riferimento visivo del corso in base al nome.
    // Riceve: nome (nome della persona).
    getCourseVisual(nome = '') {
        // key: Risultato della chiamata nome.toLowerCase, riutilizzato nelle istruzioni successive.
        const key = nome.toLowerCase();
        if (key.includes('basket')) return { icon: '🏀', tone: 'cyan' };
        if (key.includes('pallavolo')) return { icon: '🏐', tone: 'cyan' };
        if (key.includes('giocoleria')) return { icon: '🤹', tone: 'magenta' };
        if (key.includes('ginnastica')) return { icon: '🎀', tone: 'magenta' };
        if (key.includes('boxe')) return { icon: '🥊', tone: 'cyan' };
        if (key.includes('pilates') || key.includes('yoga')) return { icon: '🧘', tone: 'magenta' };
        return { icon: '✦', tone: 'cyan' };
    },

    // getRaceVisual: Sceglie il riferimento visivo della gara in base al nome.
    // Riceve: nome (nome della persona).
    getRaceVisual(nome = '') {
        // key: Risultato della chiamata nome.toLowerCase, riutilizzato nelle istruzioni successive.
        const key = nome.toLowerCase();
        if (key.includes('maratona') || key.includes('corsa')) return { icon: '👟', category: 'Corsa', tone: 'cyan' };
        if (key.includes('basket')) return { icon: '🏀', category: 'Basket', tone: 'cyan' };
        if (key.includes('boxe')) return { icon: '🥊', category: 'Boxe', tone: 'magenta' };
        return { icon: '🏆', category: 'Evento', tone: 'magenta' };
    },

    // creaCardCorso: Costruisce la scheda del corso con informazioni, immagine e azioni di iscrizione.
    // Riceve: corso (dati del corso).
    creaCardCorso(corso) {
        // visual: Icona, categoria e tono grafico scelti per la scheda del catalogo.
        const visual = this.getCourseVisual(corso.nome || '');
        // imgCorso: Risultato di uploadSrc. Restituisce un indirizzo upload coerente con nome e asset inclusi, usando il
        // ripiego per nomi non validi.
        const imgCorso = this.uploadSrc(corso.propic, 'uploads/defaults/default_corso.png');
        // nomeCoach: Nome leggibile del coach assegnato, con il testo di ripiego se assente.
        const nomeCoach = corso.coach_nome
            ? `${corso.coach_nome} ${corso.coach_cognome || ''}`.trim()
            : 'Coach non assegnato';
        // giorno: Giorno o data formattati per l’interfaccia.
        const giorno = this.formattaGiorno(corso.giorno);
        // orario: Orario formattato per l’interfaccia.
        const orario = this.formattaOrario(corso.orario_inizio);

        // card: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const card = this.creaElemento('article', {
            className: `card liquid-course-card is-${visual.tone}`
        });

        // imageWrapper: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const imageWrapper = this.creaElemento('div', { className: 'card-img-wrapper liquid-card-media' });
        // image: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const image = this.creaImmagineCard(
            imgCorso,
            'uploads/defaults/default_corso.png',
            `Copertina del corso ${corso.nome || ''}`.trim()
        );
        // badge: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const badge = this.creaElemento('span', {
            className: 'card-badge liquid-duration-badge',
            text: `${corso.durata || 60} min`
        });
        imageWrapper.append(image, badge);

        // body: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const body = this.creaElemento('div', { className: 'card-body liquid-card-body' });
        // titleRow: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const titleRow = this.creaElemento('div', { className: 'liquid-card-title-row' });
        titleRow.append(
            this.creaElemento('span', {
                className: `sport-icon sport-icon-${visual.tone}`,
                text: visual.icon,
                attrs: { 'aria-hidden': 'true' }
            }),
            this.creaElemento('h3', { className: 'card-title', text: corso.nome || 'Corso' })
        );

        // coach: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const coach = this.creaElemento('p', { className: 'card-subtitle' });
        coach.append('Coach: ', this.creaElemento('strong', { text: nomeCoach }));

        // description: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const description = this.creaElemento('p', {
            className: 'card-desc',
            text: corso.bio || 'Corso pensato per crescere, divertirsi e migliorare insieme.'
        });

        // infoBox: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const infoBox = this.creaElemento('div', { className: 'card-info-box liquid-info-box' });
        infoBox.append(
            this.creaElemento('span', { text: giorno }),
            this.creaElemento('span', { text: orario }),
            this.creaElemento('strong', {
                className: 'card-price',
                text: Number(corso.costo) > 0 ? `€${Number(corso.costo).toFixed(2)}` : 'Gratis'
            })
        );

        // action: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const action = this.creaElemento('button', {
            className: 'card-btn',
            attrs: { type: 'button' }
        });
        // isLoggato: Indicatore booleano che controlla la condizione descritta dal nome.
        const isLoggato = window.app.mioId !== undefined;
        // isIscritto: Esito booleano del controllo di presenza o corrispondenza.
        const isIscritto = window.app.mieIscrizioniCorsi?.includes(corso.id);

        if (!isLoggato) {
            action.classList.add('card-btn-login');
            action.textContent = 'Accedi o registrati';
            // Esegue l’azione del controllo quando viene premuto. Apre la modale identificata dall’id e prepara i controlli
            // collegati.
            action.addEventListener('click', () => this.apriModale('modale-login'));
        } else if (isIscritto) {
            action.classList.add('card-btn-disabled');
            action.textContent = 'Sei iscritto';
            action.disabled = true;
        } else {
            action.classList.add('card-btn-iscriviti');
            action.textContent = 'Iscriviti';
            // Esegue l’azione del controllo quando viene premuto. Richiede l’iscrizione al corso e aggiorna gli identificativi
            // conservati dal frontend.
            action.addEventListener('click', () => this.iscrivitiCorso(corso.id));
        }

        body.append(titleRow, coach, description, infoBox, action);
        card.append(imageWrapper, body);
        return card;
    },

    // creaCardGara: Costruisce la scheda della gara con informazioni e azioni disponibili all’utente.
    // Riceve: gara (dati della gara).
    creaCardGara(gara) {
        // visual: Icona, categoria e tono grafico scelti per la scheda del catalogo.
        const visual = this.getRaceVisual(gara.nome || '');
        // imgGara: Risultato di uploadSrc. Restituisce un indirizzo upload coerente con nome e asset inclusi, usando il
        // ripiego per nomi non validi.
        const imgGara = this.uploadSrc(gara.propic, 'uploads/defaults/default_gara.png');
        // dataGara: Valore scelto tra i due rami in base alla condizione indicata.
        const dataGara = gara.giorno ? new Date(gara.giorno.slice(0, 10) + 'T12:00:00').toLocaleDateString('it-IT', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }) : 'Data da definire';

        // card: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const card = this.creaElemento('article', {
            className: `card gara liquid-race-card is-${visual.tone}`
        });

        // imageWrapper: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const imageWrapper = this.creaElemento('div', { className: 'card-img-wrapper liquid-card-media' });
        imageWrapper.append(
            this.creaImmagineCard(
                imgGara,
                'uploads/defaults/default_gara.png',
                `Copertina della gara ${gara.nome || ''}`.trim()
            ),
            this.creaElemento('span', {
                className: `sport-icon sport-icon-${visual.tone} race-floating-icon`,
                text: visual.icon,
                attrs: { 'aria-hidden': 'true' }
            })
        );

        // body: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const body = this.creaElemento('div', { className: 'card-body liquid-card-body' });
        body.append(
            this.creaElemento('h3', { className: 'card-title', text: gara.nome || 'Gara' }),
            this.creaElemento('p', {
                className: 'card-desc',
                text: gara.bio || 'Evento sportivo aperto alla comunità.'
            })
        );

        // infoBox: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const infoBox = this.creaElemento('div', { className: 'card-info-box liquid-info-box' });
        infoBox.append(
            this.creaElemento('span', { text: dataGara }),
            this.creaElemento('span', { text: visual.category }),
            this.creaElemento('strong', {
                className: 'card-price',
                text: Number(gara.costo) > 0 ? `€${Number(gara.costo).toFixed(2)}` : 'Gratis'
            })
        );

        // action: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const action = this.creaElemento('button', {
            className: 'card-btn',
            attrs: { type: 'button' }
        });
        // isLoggato: Indicatore booleano che controlla la condizione descritta dal nome.
        const isLoggato = window.app.mioId !== undefined;
        // isIscritto: Esito booleano del controllo di presenza o corrispondenza.
        const isIscritto = window.app.mieIscrizioniGare?.includes(gara.id);

        if (!isLoggato) {
            action.classList.add('card-btn-login');
            action.textContent = 'Accedi per iscriverti';
            // Esegue l’azione del controllo quando viene premuto. Apre la modale identificata dall’id e prepara i controlli
            // collegati.
            action.addEventListener('click', () => this.apriModale('modale-login'));
        } else if (isIscritto) {
            action.classList.add('card-btn-disiscriviti');
            action.textContent = 'Ritirati';
            // Esegue l’azione del controllo quando viene premuto. Chiede conferma, annulla l’iscrizione alla gara e aggiorna
            // l’interfaccia.
            action.addEventListener('click', () => this.disiscrivitiGara(gara.id));
        } else {
            action.classList.add('card-btn-iscriviti');
            action.textContent = 'Iscriviti';
            // Esegue l’azione del controllo quando viene premuto. Richiede l’iscrizione alla gara e aggiorna lo stato locale
            // della pagina.
            action.addEventListener('click', () => this.iscrivitiGara(gara.id));
        }

        body.append(infoBox, action);
        card.append(imageWrapper, body);
        return card;
    }
});
