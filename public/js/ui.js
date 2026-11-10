window.app = window.app || {};
const indirizziPagine = {
    home: 'home', dashboard: 'corsi', gare: 'gare', chat: 'chat',
    profilo: 'area', admin: 'admin', coach: 'coach'
};

Object.assign(window.app, {

    async caricaAnteprimaHome() {
        const corsi = document.getElementById('home-corsi');
        const gare = document.getElementById('home-gare');
        const [corsiResult, gareResult] = await Promise.allSettled([
            this.apiRequest('/api/corsi'),
            this.apiRequest('/api/gare')
        ]);
        const stato = (element, message) => element.replaceChildren(this.creaElemento('p', { text: message }));
        const creaVoce = (page, ...children) => {
            const button = this.creaElemento('button', { attrs: { type: 'button' } });
            button.append(...children);
            button.addEventListener('click', () => this.naviga(page));
            return button;
        };
        if (corsi && corsiResult.status === 'fulfilled' && Array.isArray(corsiResult.value)) {
            const cards = corsiResult.value.slice(0, 8).map(corso => {
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
            const parts = new Intl.DateTimeFormat('it-IT', {
                timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
            }).formatToParts(new Date());
            const now = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
            const cutoff = [now.year, now.month, now.day].join('-') + ' ' + now.hour + ':' + now.minute;
            const future = gareResult.value.filter(gara =>
                /^\d{4}-\d{2}-\d{2}$/.test(gara.giorno || '') &&
                gara.giorno + ' ' + (gara.orario?.slice(0, 5) || '23:59') >= cutoff
            ).slice(0, 3);
            const cards = future.map(gara => {
                const date = new Date(gara.giorno + 'T12:00:00');
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
    
    navigaDaIndirizzo() {
        const hash = window.location.hash.slice(1);
        const pagina = Object.keys(indirizziPagine).find(key => indirizziPagine[key] === hash) || 'home';
        if (!this.naviga(pagina, { aggiornaIndirizzo: false })) {
            this.naviga('home', { aggiornaIndirizzo: false });
        }
    },

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
        if (idPagina === 'admin' && window.app.utenteCorrente?.ruolo !== 'ADMIN') {
            this.mostraNotifica?.('Area riservata agli amministratori.', 'warning');
            return;
        }
        if (idPagina === 'coach' && window.app.utenteCorrente?.ruolo !== 'COACH') {
            this.mostraNotifica?.('Area riservata ai coach.', 'warning');
            return;
        }

        const sezioneScelta = document.getElementById('pagina-' + idPagina);
        if (!sezioneScelta || !indirizziPagine[idPagina]) return false;
        const hash = '#' + indirizziPagine[idPagina];
        if (aggiornaIndirizzo && window.location.hash !== hash) history.pushState(null, '', hash);
        const sezioni = document.querySelectorAll('.sezione-pagina');
        sezioni.forEach(sezione => sezione.classList.add('hidden'));

        sezioneScelta.classList.remove('hidden');

        const navMap = {
            home: ['btn-home'],
            dashboard: ['btn-dashboard'],
            gare: ['btn-gare'],
            chat: ['btn-chat'],
            profilo: ['btn-profilo', 'btn-area-mobile'],
            admin: ['btn-admin'],
            coach: ['btn-coach']
        };
        document.querySelectorAll('.navbar button').forEach(button => {
            button.classList.remove('is-active');
            button.removeAttribute('aria-current');
        });
        (navMap[idPagina] || []).forEach(buttonId => {
            const activeButton = document.getElementById(buttonId);
            if (!activeButton) return;
            activeButton.classList.add('is-active');
            activeButton.setAttribute('aria-current', 'page');
        });

        document.body.classList.toggle('chat-page-active', idPagina === 'chat');
        document.body.dataset.currentPage = idPagina;
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
            setTimeout(() => { if(typeof this.scrollaChatInFondo === 'function') this.scrollaChatInFondo(); }, 300);
        }
        return true;
    },

    mostraNotifica(messaggio, tipo = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = this.creaElemento('div', { className: `toast ${tipo}` });
        toast.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', tipo === 'error' ? 'assertive' : 'polite');

        const icone = { success: 'OK', error: '!', warning: '!', info: 'i' };
        const icona = this.creaElemento('span', {
            className: 'toast-icon',
            text: icone[tipo] || 'i',
            attrs: { 'aria-hidden': 'true' }
        });

        const testo = this.creaElemento('span', {
            className: 'toast-message',
            text: messaggio ?? ''
        });

        toast.replaceChildren(icona, testo);

        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300); 
        }, 3000);
    },

    confermaAzione({
        titolo = 'Conferma azione',
        messaggio = 'Vuoi continuare?',
        testoConferma = 'Conferma',
        testoAnnulla = 'Annulla',
        tipo = 'warning'
    } = {}) {
        return new Promise((resolve) => {
            document.getElementById('modale-conferma-app')?.remove();

            const overlay = this.creaElemento('div', {
                className: 'modal-overlay app-confirm-overlay active',
                attrs: {
                    id: 'modale-conferma-app',
                    role: 'dialog',
                    'aria-modal': 'true',
                    'aria-labelledby': 'titolo-conferma-app'
                }
            });

            const dialog = this.creaElemento('div', { className: `app-confirm-dialog is-${tipo}` });
            const icon = this.creaElemento('span', {
                className: 'app-confirm-icon',
                text: tipo === 'danger' ? '!' : '?',
                attrs: { 'aria-hidden': 'true' }
            });
            const title = this.creaElemento('h2', {
                text: titolo,
                attrs: { id: 'titolo-conferma-app' }
            });
            const message = this.creaElemento('p', { text: messaggio });
            const actions = this.creaElemento('div', { className: 'app-confirm-actions' });
            const cancelButton = this.creaElemento('button', {
                className: 'app-confirm-cancel',
                text: testoAnnulla,
                attrs: { type: 'button' }
            });
            const confirmButton = this.creaElemento('button', {
                className: `app-confirm-submit is-${tipo}`,
                text: testoConferma,
                attrs: { type: 'button' }
            });

            let closed = false;
            const close = (confirmed) => {
                if (closed) return;
                closed = true;
                document.removeEventListener('keydown', onKeydown);
                overlay.classList.remove('active');
                window.setTimeout(() => overlay.remove(), 180);
                resolve(confirmed);
            };

            const onKeydown = (event) => {
                if (event.key === 'Escape') close(false);
            };

            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) close(false);
            });
            cancelButton.addEventListener('click', () => close(false));
            confirmButton.addEventListener('click', () => close(true));
            document.addEventListener('keydown', onKeydown);

            actions.append(cancelButton, confirmButton);
            dialog.append(icon, title, message, actions);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            const initialFocus = tipo === 'danger' ? cancelButton : confirmButton;
            window.setTimeout(() => initialFocus.focus({ preventScroll: true }), 50);
        });
    },

    apriModale(idModale) {
        const m = document.getElementById(idModale);
        if (!m) return;
        m.classList.add('active');
        if (typeof this.preparaRecaptchaModale === 'function') {
            this.preparaRecaptchaModale(idModale);
        }
    },

    chiudiModale(idModale) {
        const m = document.getElementById(idModale);
        if (!m) return;
        m.classList.remove('active');
        if (typeof this.resettaRecaptcha === 'function') {
            this.resettaRecaptcha(idModale);
        }
    },

    apriImmagineFullscreen(src) {
        let modale = document.getElementById('modale-immagine-fullscreen');
        
        if (!modale) {
            modale = document.createElement('div');
            modale.id = 'modale-immagine-fullscreen';
            document.body.appendChild(modale);
            
            modale.addEventListener('click', (e) => {
                if (e.target.id === 'modale-immagine-fullscreen') app.chiudiImmagineFullscreen();
            });
        }
        
        const chiudi = this.creaElemento('button', {
            className: 'chiudi-fullscreen',
            text: 'x',
            attrs: { type: 'button', 'aria-label': 'Chiudi immagine' }
        });
        chiudi.addEventListener('click', () => app.chiudiImmagineFullscreen());

        const immagine = this.creaElemento('img', {
            attrs: { src, alt: 'Immagine allegata', decoding: 'async' }
        });

        modale.replaceChildren(chiudi, immagine);
        
        modale.style.display = 'flex';
        setTimeout(() => modale.classList.add('active'), 10);
    },

    chiudiImmagineFullscreen() {
        const modale = document.getElementById('modale-immagine-fullscreen');
        if (modale) {
            modale.classList.remove('active');
            setTimeout(() => modale.style.display = 'none', 300);
        }
    },

    creaStatoVuotoCatalogo(messaggio) {
        return this.creaElemento('p', {
            className: 'catalog-empty-state',
            text: messaggio
        });
    },

    creaImmagineCard(src, fallback, alt) {
        const image = this.creaElemento('img', {
            className: 'card-img',
            attrs: { src, alt, loading: 'lazy', decoding: 'async' }
        });
        image.addEventListener('error', () => {
            if (!image.src.endsWith(fallback)) image.src = fallback;
        });
        return image;
    },

    async caricaCorsi() {
        try {
            const corsi = await this.apiRequest('/api/corsi');
            const contenitore = document.getElementById('contenitore-corsi');
            if (!contenitore) return;
            this.svuotaElemento(contenitore);

            if (corsi.length === 0) {
                contenitore.appendChild(this.creaStatoVuotoCatalogo('Nessun corso disponibile.'));
                return;
            }

            const fragment = document.createDocumentFragment();
            corsi.forEach(corso => fragment.appendChild(this.creaCardCorso(corso)));
            contenitore.appendChild(fragment);
        } catch (error) {
            console.error("Errore caricamento corsi:", error);
            const contenitore = document.getElementById('contenitore-corsi');
            contenitore?.replaceChildren(
                this.creaStatoVuotoCatalogo(this.apiErrorMessage(error, 'Errore caricamento corsi.'))
            );
        }
    },

    async caricaGare() {
        try {
            const gare = await this.apiRequest('/api/gare');
            const contenitore = document.getElementById('contenitore-gare');
            if (!contenitore) return;
            this.svuotaElemento(contenitore);

            if (gare.length === 0) {
                contenitore.appendChild(this.creaStatoVuotoCatalogo('Nessuna gara in programma.'));
                return;
            }

            const fragment = document.createDocumentFragment();
            gare.forEach(gara => fragment.appendChild(this.creaCardGara(gara)));
            contenitore.appendChild(fragment);
        } catch (error) {
            console.error("Errore caricamento gare:", error);
            const contenitore = document.getElementById('contenitore-gare');
            contenitore?.replaceChildren(
                this.creaStatoVuotoCatalogo(this.apiErrorMessage(error, 'Errore caricamento gare.'))
            );
        }
    }
});

Object.assign(window.app, {
    roleLabel(ruolo) {
        const labels = {
            ADMIN: 'Admin',
            COACH: 'Coach',
            PARTNER: 'Iscritto'
        };
        return labels[ruolo] || ruolo || 'Iscritto';
    },

    formattaOrario(value) {
        if (!value) return '--:--';
        return String(value).slice(0, 5);
    },

    formattaGiorno(value, fallback = 'Da definire') {
        const raw = String(value || '').trim();
        if (!raw) return fallback;

        const key = raw
            .toLocaleLowerCase('it-IT')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
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

    getCourseVisual(nome = '') {
        const key = nome.toLowerCase();
        if (key.includes('basket')) return { icon: '🏀', tone: 'cyan' };
        if (key.includes('pallavolo')) return { icon: '🏐', tone: 'cyan' };
        if (key.includes('giocoleria')) return { icon: '🤹', tone: 'magenta' };
        if (key.includes('ginnastica')) return { icon: '🎀', tone: 'magenta' };
        if (key.includes('boxe')) return { icon: '🥊', tone: 'cyan' };
        if (key.includes('pilates') || key.includes('yoga')) return { icon: '🧘', tone: 'magenta' };
        return { icon: '✦', tone: 'cyan' };
    },

    getRaceVisual(nome = '') {
        const key = nome.toLowerCase();
        if (key.includes('maratona') || key.includes('corsa')) return { icon: '👟', category: 'Corsa', tone: 'cyan' };
        if (key.includes('basket')) return { icon: '🏀', category: 'Basket', tone: 'cyan' };
        if (key.includes('boxe')) return { icon: '🥊', category: 'Boxe', tone: 'magenta' };
        return { icon: '🏆', category: 'Evento', tone: 'magenta' };
    },

    creaCardCorso(corso) {
        const visual = this.getCourseVisual(corso.nome || '');
        const imgCorso = this.uploadSrc(corso.propic, 'uploads/defaults/default_corso.png');
        const nomeCoach = corso.coach_nome
            ? `${corso.coach_nome} ${corso.coach_cognome || ''}`.trim()
            : 'Coach non assegnato';
        const giorno = this.formattaGiorno(corso.giorno);
        const orario = this.formattaOrario(corso.orario_inizio);

        const card = this.creaElemento('article', {
            className: `card liquid-course-card is-${visual.tone}`
        });

        const imageWrapper = this.creaElemento('div', { className: 'card-img-wrapper liquid-card-media' });
        const image = this.creaImmagineCard(
            imgCorso,
            'uploads/defaults/default_corso.png',
            `Copertina del corso ${corso.nome || ''}`.trim()
        );
        const badge = this.creaElemento('span', {
            className: 'card-badge liquid-duration-badge',
            text: `${corso.durata || 60} min`
        });
        imageWrapper.append(image, badge);

        const body = this.creaElemento('div', { className: 'card-body liquid-card-body' });
        const titleRow = this.creaElemento('div', { className: 'liquid-card-title-row' });
        titleRow.append(
            this.creaElemento('span', {
                className: `sport-icon sport-icon-${visual.tone}`,
                text: visual.icon,
                attrs: { 'aria-hidden': 'true' }
            }),
            this.creaElemento('h3', { className: 'card-title', text: corso.nome || 'Corso' })
        );

        const coach = this.creaElemento('p', { className: 'card-subtitle' });
        coach.append('Coach: ', this.creaElemento('strong', { text: nomeCoach }));

        const description = this.creaElemento('p', {
            className: 'card-desc',
            text: corso.bio || 'Corso pensato per crescere, divertirsi e migliorare insieme.'
        });

        const infoBox = this.creaElemento('div', { className: 'card-info-box liquid-info-box' });
        infoBox.append(
            this.creaElemento('span', { text: giorno }),
            this.creaElemento('span', { text: orario }),
            this.creaElemento('strong', {
                className: 'card-price',
                text: Number(corso.costo) > 0 ? `€${Number(corso.costo).toFixed(2)}` : 'Gratis'
            })
        );

        const action = this.creaElemento('button', {
            className: 'card-btn',
            attrs: { type: 'button' }
        });
        const isLoggato = window.app.mioId !== undefined;
        const isIscritto = window.app.mieIscrizioniCorsi?.includes(corso.id);

        if (!isLoggato) {
            action.classList.add('card-btn-login');
            action.textContent = 'Accedi o registrati';
            action.addEventListener('click', () => this.apriModale('modale-login'));
        } else if (isIscritto) {
            action.classList.add('card-btn-disabled');
            action.textContent = 'Sei iscritto';
            action.disabled = true;
        } else {
            action.classList.add('card-btn-iscriviti');
            action.textContent = 'Iscriviti';
            action.addEventListener('click', () => this.iscrivitiCorso(corso.id));
        }

        body.append(titleRow, coach, description, infoBox, action);
        card.append(imageWrapper, body);
        return card;
    },

    creaCardGara(gara) {
        const visual = this.getRaceVisual(gara.nome || '');
        const imgGara = this.uploadSrc(gara.propic, 'uploads/defaults/default_gara.png');
        const dataGara = gara.giorno ? new Date(gara.giorno.slice(0, 10) + 'T12:00:00').toLocaleDateString('it-IT', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }) : 'Data da definire';

        const card = this.creaElemento('article', {
            className: `card gara liquid-race-card is-${visual.tone}`
        });

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

        const body = this.creaElemento('div', { className: 'card-body liquid-card-body' });
        body.append(
            this.creaElemento('h3', { className: 'card-title', text: gara.nome || 'Gara' }),
            this.creaElemento('p', {
                className: 'card-desc',
                text: gara.bio || 'Evento sportivo aperto alla comunità.'
            })
        );

        const infoBox = this.creaElemento('div', { className: 'card-info-box liquid-info-box' });
        infoBox.append(
            this.creaElemento('span', { text: dataGara }),
            this.creaElemento('span', { text: visual.category }),
            this.creaElemento('strong', {
                className: 'card-price',
                text: Number(gara.costo) > 0 ? `€${Number(gara.costo).toFixed(2)}` : 'Gratis'
            })
        );

        const action = this.creaElemento('button', {
            className: 'card-btn',
            attrs: { type: 'button' }
        });
        const isLoggato = window.app.mioId !== undefined;
        const isIscritto = window.app.mieIscrizioniGare?.includes(gara.id);

        if (!isLoggato) {
            action.classList.add('card-btn-login');
            action.textContent = 'Accedi per iscriverti';
            action.addEventListener('click', () => this.apriModale('modale-login'));
        } else if (isIscritto) {
            action.classList.add('card-btn-disiscriviti');
            action.textContent = 'Ritirati';
            action.addEventListener('click', () => this.disiscrivitiGara(gara.id));
        } else {
            action.classList.add('card-btn-iscriviti');
            action.textContent = 'Iscriviti';
            action.addEventListener('click', () => this.iscrivitiGara(gara.id));
        }

        body.append(infoBox, action);
        card.append(imageWrapper, body);
        return card;
    }
});
