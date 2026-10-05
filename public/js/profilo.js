window.app = window.app || {};

Object.assign(window.app, {

    async caricaProfilo() {
        try {
            const dati = await this.apiRequest('/api/profilo');

            document.getElementById('testo-email').innerText = dati.utente.email;
            document.getElementById('testo-ruolo').textContent = this.roleLabel?.(dati.utente.ruolo) || dati.utente.ruolo;
            document.getElementById('btn-admin-profilo')?.classList.toggle('hidden', dati.utente.ruolo !== 'ADMIN');
            document.getElementById('input-nome').value = dati.utente.nome || '';
            document.getElementById('input-cognome').value = dati.utente.cognome || '';
            document.getElementById('input-eta').value = dati.utente.eta || '';
            document.getElementById('input-bio').value = dati.utente.bio || '';
            
            if (dati.utente.propic) document.getElementById('img-propic').src = this.uploadSrc(dati.utente.propic);

            this.renderProfileCourses(dati.iscrizioni || []);
            this.renderProfileRaces(dati.iscrizioni_gare || []);

            const scadenza = dati.utente.certificato_scadenza;
            const luce = document.getElementById('semaforo-luce');
            const testo = document.getElementById('semaforo-testo');

            const setCertificateState = (state, message) => {
                luce.className = `profile-certificate-dot is-${state}`;
                testo.className = `profile-certificate-text is-${state}`;
                testo.innerText = message;
            };

            if (!scadenza) {
                setCertificateState('danger', "Certificato mancante");
            } else {
                const oggi = new Date();
                const dataScadenza = new Date(scadenza);
                
                if (dataScadenza > oggi) {
                    setCertificateState('success', "In regola fino al " + dataScadenza.toLocaleDateString('it-IT'));
                } else {
                    setCertificateState('danger', "Certificato scaduto il " + dataScadenza.toLocaleDateString('it-IT'));
                }
            }

        } catch (error) {
            if (error.status === 401) {
                this.mostraNotifica("Accedi per vedere il tuo profilo.", "warning");
                this.renderProfileMessage(document.getElementById('lista-mie-iscrizioni'), "Accedi per vedere i tuoi corsi.");
                this.renderProfileMessage(document.getElementById('lista-mie-gare'), "Accedi per vedere le tue gare.");
                return;
            }
            console.error("Errore profilo:", error);
            this.mostraNotifica(this.apiErrorMessage(error), "error");
        }
    },

    renderProfileMessage(container, message) {
        if (!container) return;
        this.svuotaElemento(container);
        const text = this.creaElemento('p', {
            className: 'profile-empty-state',
            text: message
        });
        container.appendChild(text);
    },

    async aggiornaDatiPersonali() {
        const nome = document.getElementById('input-nome').value.trim();
        const cognome = document.getElementById('input-cognome').value.trim();
        const eta = document.getElementById('input-eta').value;
        const bio = document.getElementById('input-bio').value;

        if (!nome || !cognome) return this.mostraNotifica("Nome e cognome sono obbligatori.", "warning");

        try {
            const risultato = await this.apiRequest('/api/profilo/dati', {
                method: 'PUT',
                body: { nome, cognome, eta, bio }
            });

            this.mostraNotifica(risultato.messaggio, "success");
            this.caricaProfilo();
        } catch (error) { this.mostraNotifica(this.apiErrorMessage(error), "error"); }
        
    },

    async aggiornaPropic() {
        const fileInput = document.getElementById('input-propic');
        if (fileInput.files.length === 0) return;

        const formData = new FormData();
        formData.append('immagine', fileInput.files[0]);

        try {
            const risultato = await this.apiRequest('/api/profilo/propic', { method: 'POST', body: formData });
            document.getElementById('img-propic').src = this.uploadSrc(risultato.propic);
            this.mostraNotifica(risultato.messaggio, "success");
        } catch (error) { this.mostraNotifica(this.apiErrorMessage(error, "Impossibile caricare l'immagine."), "error"); }
    },

    async iscrivitiCorso(idCorso) {
        try {
            await this.apiRequest('/api/iscriviti', {
                method: 'POST',
                body: { corso_id: idCorso }
            });

            if(typeof this.mostraNotifica === 'function') this.mostraNotifica("Iscrizione al corso completata.", "success");
            if (!window.app.mieIscrizioniCorsi) window.app.mieIscrizioniCorsi = [];
            window.app.mieIscrizioniCorsi.push(idCorso);
            this.caricaCorsi();
        } catch (error) {
            if(typeof this.mostraNotifica === 'function') this.mostraNotifica(this.apiErrorMessage(error), "error");
        }
    },

    async iscrivitiGara(idGara) {
        try {
            await this.apiRequest('/api/iscriviti-gara', {
                method: 'POST',
                body: { gara_id: idGara }
            });

            if(typeof this.mostraNotifica === 'function') this.mostraNotifica("Iscrizione alla gara completata.", "success");
            if (!window.app.mieIscrizioniGare) window.app.mieIscrizioniGare = [];
            window.app.mieIscrizioniGare.push(idGara);
            this.caricaGare();
        } catch (error) {
            if(typeof this.mostraNotifica === 'function') this.mostraNotifica(this.apiErrorMessage(error), "error");
        }
    },

    async disiscriviti(idCorso) {
        const confirmed = await this.confermaAzione({
            titolo: 'Annullare l’iscrizione?',
            messaggio: 'Il corso verrà rimosso dalla tua area personale.',
            testoConferma: 'Annulla iscrizione'
        });
        if (!confirmed) return;

        try {
            await this.apiRequest('/api/disiscriviti', {
                method: 'POST',
                body: { corso_id: idCorso }
            });

            this.mostraNotifica("Iscrizione annullata.", "info");
            if (window.app.mieIscrizioniCorsi) {
                window.app.mieIscrizioniCorsi = window.app.mieIscrizioniCorsi.filter(id => id !== idCorso);
            }
            if (typeof this.caricaCorsi === 'function') this.caricaCorsi();
            this.caricaProfilo();
        } catch (error) {
            this.mostraNotifica(this.apiErrorMessage(error), "error");
        }
    },

    async disiscrivitiGara(idGara) {
        const confirmed = await this.confermaAzione({
            titolo: 'Ritirarti dalla gara?',
            messaggio: 'La gara verrà rimossa dalle tue iscrizioni.',
            testoConferma: 'Ritirati dalla gara'
        });
        if (!confirmed) return;

        try {
            await this.apiRequest('/api/disiscriviti-gara', {
                method: 'POST',
                body: { gara_id: idGara }
            });

            this.mostraNotifica("Iscrizione alla gara annullata.", "info");
            if (window.app.mieIscrizioniGare) {
                window.app.mieIscrizioniGare = window.app.mieIscrizioniGare.filter(id => id !== idGara);
            }
            if (typeof this.caricaGare === 'function') this.caricaGare();
            this.caricaProfilo();
        } catch (error) {
            this.mostraNotifica(this.apiErrorMessage(error), "error");
        }
    }
});

Object.assign(window.app, {
    createProfileCourseCard(corso) {
        const visual = this.getCourseVisual?.(corso.nome || '') || { icon: '✦', tone: 'cyan' };
        const item = this.creaElemento('article', { className: 'profile-compact-card' });
        const icon = this.creaElemento('span', {
            className: `sport-icon sport-icon-${visual.tone}`,
            text: visual.icon,
            attrs: { 'aria-hidden': 'true' }
        });
        const content = this.creaElemento('div', { className: 'profile-compact-content' });
        content.append(
            this.creaElemento('strong', { text: corso.nome || 'Corso senza nome' }),
            this.creaElemento('small', {
                text: `${this.formattaGiorno?.(corso.giorno) || 'Giorno da definire'} · ${this.formattaOrario?.(corso.orario_inizio) || corso.orario_inizio || '--:--'}`
            })
        );
        const action = this.creaElemento('button', {
            className: 'profile-compact-arrow',
            text: 'Disiscriviti',
            attrs: { type: 'button' }
        });
        action.addEventListener('click', () => this.disiscriviti(corso.id));
        item.append(icon, content, action);
        return item;
    },

    createProfileRaceCard(gara) {
        const visual = this.getRaceVisual?.(gara.nome || '') || { icon: '🏆', tone: 'magenta' };
        const dataGara = gara.giorno ? new Date(gara.giorno).toLocaleDateString('it-IT', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }) : 'Data da definire';
        const item = this.creaElemento('article', { className: 'profile-compact-card profile-race-card' });
        const icon = this.creaElemento('span', {
            className: `sport-icon sport-icon-${visual.tone}`,
            text: visual.icon,
            attrs: { 'aria-hidden': 'true' }
        });
        const content = this.creaElemento('div', { className: 'profile-compact-content' });
        content.append(
            this.creaElemento('strong', { text: gara.nome || 'Gara senza nome' }),
            this.creaElemento('small', { text: `${dataGara} · ${this.formattaOrario?.(gara.orario) || gara.orario || '--:--'}` })
        );
        const action = this.creaElemento('button', {
            className: 'profile-compact-arrow',
            text: 'Ritirati',
            attrs: { type: 'button' }
        });
        action.addEventListener('click', () => this.disiscrivitiGara(gara.id));
        item.append(icon, content, action);
        return item;
    },

    renderProfileCourses(corsi) {
        const container = document.getElementById('lista-mie-iscrizioni');
        if (!container) return;
        this.svuotaElemento(container);

        if (!corsi.length) {
            this.renderProfileMessage(container, 'Non sei ancora iscritto a nessun corso.');
            return;
        }

        const grid = this.creaElemento('div', { className: 'profile-compact-grid' });
        corsi.forEach(corso => grid.appendChild(this.createProfileCourseCard(corso)));
        container.appendChild(grid);
    },

    renderProfileRaces(gare) {
        const container = document.getElementById('lista-mie-gare');
        if (!container) return;
        this.svuotaElemento(container);

        if (!gare.length) {
            this.renderProfileMessage(container, 'Non sei iscritto a nessuna gara.');
            return;
        }

        const grid = this.creaElemento('div', { className: 'profile-compact-grid profile-race-grid' });
        gare.forEach(gara => grid.appendChild(this.createProfileRaceCard(gara)));
        container.appendChild(grid);
    }
});
