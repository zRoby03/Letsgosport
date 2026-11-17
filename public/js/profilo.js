// Frontend profilo: visualizza dati personali e iscrizioni e invia aggiornamenti al backend.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
window.app = window.app || {};

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {

    // caricaProfilo: Carica il profilo autenticato e rappresenta dati personali, certificato e iscrizioni.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaProfilo() {
        try {
            // dati: Dati ricevuti dall’API o dall’evento di questo blocco.
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

            // scadenza: Valore della proprietà dati.utente.certificato_scadenza, conservato per le operazioni successive.
            const scadenza = dati.utente.certificato_scadenza;
            // luce: Elemento DOM semaforo-luce: Contenitore dell’interfaccia.
            const luce = document.getElementById('semaforo-luce');
            // testo: Elemento DOM semaforo-testo: Etichetta o indicatore dell’interfaccia.
            const testo = document.getElementById('semaforo-testo');

            // setCertificateState: Mostra lo stato del certificato con la dicitura e lo stile corrispondenti.
            // Riceve: state (stato da rappresentare); message (testo del messaggio).
            const setCertificateState = (state, message) => {
                luce.className = `profile-certificate-dot is-${state}`;
                testo.className = `profile-certificate-text is-${state}`;
                testo.innerText = message;
            };

            if (!scadenza) {
                setCertificateState('danger', "Certificato mancante");
            } else {
                // oggi: Riferimento temporale rappresentato tramite l’oggetto Date.
                const oggi = new Date();
                // dataScadenza: Riferimento temporale rappresentato tramite l’oggetto Date.
                const dataScadenza = new Date(scadenza);
                
                if (dataScadenza > oggi) {
                    setCertificateState('success', "In regola fino al " + dataScadenza.toLocaleDateString('it-IT'));
                } else {
                    setCertificateState('danger', "Certificato scaduto il " + dataScadenza.toLocaleDateString('it-IT'));
                }
            }

        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
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

    // renderProfileMessage: Mostra un messaggio di stato nel contenitore del profilo.
    // Riceve: container (contenitore del DOM); message (testo del messaggio).
    renderProfileMessage(container, message) {
        if (!container) return;
        this.svuotaElemento(container);
        // text: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const text = this.creaElemento('p', {
            className: 'profile-empty-state',
            text: message
        });
        container.appendChild(text);
    },

    // aggiornaDatiPersonali: Raccoglie e invia i campi personali modificabili, aggiornando poi il profilo.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async aggiornaDatiPersonali() {
        // nome: Valore letto dal campo HTML da validare o inviare.
        const nome = document.getElementById('input-nome').value.trim();
        // cognome: Valore letto dal campo HTML da validare o inviare.
        const cognome = document.getElementById('input-cognome').value.trim();
        // eta: Valore letto dal campo HTML da validare o inviare.
        const eta = document.getElementById('input-eta').value;
        // bio: Valore letto dal campo HTML da validare o inviare.
        const bio = document.getElementById('input-bio').value;

        if (!nome || !cognome) return this.mostraNotifica("Nome e cognome sono obbligatori.", "warning");

        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        try {
            // risultato: Esito della richiesta al backend utilizzato per aggiornare l’interfaccia.
            const risultato = await this.apiRequest('/api/profilo/dati', {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
                method: 'PUT',
                body: { nome, cognome, eta, bio }
            });

            this.mostraNotifica(risultato.messaggio, "success");
            this.caricaProfilo();
        } catch (error) { this.mostraNotifica(this.apiErrorMessage(error), "error"); }
        
    },

    // aggiornaPropic: Carica la nuova immagine del profilo tramite FormData.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async aggiornaPropic() {
        // fileInput: Elemento DOM input-propic: Carica una nuova foto profilo.
        const fileInput = document.getElementById('input-propic');
        if (fileInput.files.length === 0) return;

        // formData: Contenitore multipart per campi del form e file binari.
        const formData = new FormData();
        formData.append('immagine', fileInput.files[0]);

        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        try {
            // risultato: Esito della richiesta al backend utilizzato per aggiornare l’interfaccia.
            // method: Metodo HTTP che identifica l’operazione richiesta al backend.
            const risultato = await this.apiRequest('/api/profilo/propic', { method: 'POST', body: formData });
            document.getElementById('img-propic').src = this.uploadSrc(risultato.propic);
            this.mostraNotifica(risultato.messaggio, "success");
        } catch (error) { this.mostraNotifica(this.apiErrorMessage(error, "Impossibile caricare l'immagine."), "error"); }
    },

    // iscrivitiCorso: Richiede l’iscrizione al corso e aggiorna gli identificativi conservati dal frontend.
    // Riceve: idCorso (id del corso).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async iscrivitiCorso(idCorso) {
        try {
            await this.apiRequest('/api/iscriviti', {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
                method: 'POST',
                body: { corso_id: idCorso }
            });

            if(typeof this.mostraNotifica === 'function') this.mostraNotifica("Iscrizione al corso completata.", "success");
            if (!window.app.mieIscrizioniCorsi) window.app.mieIscrizioniCorsi = [];
            window.app.mieIscrizioniCorsi.push(idCorso);
            this.caricaCorsi();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            if(typeof this.mostraNotifica === 'function') this.mostraNotifica(this.apiErrorMessage(error), "error");
        }
    },

    // iscrivitiGara: Richiede l’iscrizione alla gara e aggiorna lo stato locale della pagina.
    // Riceve: idGara (id della gara).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async iscrivitiGara(idGara) {
        try {
            await this.apiRequest('/api/iscriviti-gara', {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
                method: 'POST',
                body: { gara_id: idGara }
            });

            if(typeof this.mostraNotifica === 'function') this.mostraNotifica("Iscrizione alla gara completata.", "success");
            if (!window.app.mieIscrizioniGare) window.app.mieIscrizioniGare = [];
            window.app.mieIscrizioniGare.push(idGara);
            this.caricaGare();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            if(typeof this.mostraNotifica === 'function') this.mostraNotifica(this.apiErrorMessage(error), "error");
        }
    },

    // disiscriviti: Chiede conferma, annulla l’iscrizione al corso e aggiorna catalogo e profilo.
    // Riceve: idCorso (id del corso).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async disiscriviti(idCorso) {
        // confirmed: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const confirmed = await this.confermaAzione({
            titolo: 'Annullare l’iscrizione?',
            messaggio: 'Il corso verrà rimosso dalla tua area personale.',
            testoConferma: 'Annulla iscrizione'
        });
        if (!confirmed) return;

        try {
            await this.apiRequest('/api/disiscriviti', {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
                method: 'POST',
                body: { corso_id: idCorso }
            });

            this.mostraNotifica("Iscrizione annullata.", "info");
            if (window.app.mieIscrizioniCorsi) {
                // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
                // Riceve: id (identificativo dell’elemento).
                window.app.mieIscrizioniCorsi = window.app.mieIscrizioniCorsi.filter(id => id !== idCorso);
            }
            if (typeof this.caricaCorsi === 'function') this.caricaCorsi();
            this.caricaProfilo();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this.mostraNotifica(this.apiErrorMessage(error), "error");
        }
    },

    // disiscrivitiGara: Chiede conferma, annulla l’iscrizione alla gara e aggiorna l’interfaccia.
    // Riceve: idGara (id della gara).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async disiscrivitiGara(idGara) {
        // confirmed: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const confirmed = await this.confermaAzione({
            titolo: 'Ritirarti dalla gara?',
            messaggio: 'La gara verrà rimossa dalle tue iscrizioni.',
            testoConferma: 'Ritirati dalla gara'
        });
        if (!confirmed) return;

        try {
            await this.apiRequest('/api/disiscriviti-gara', {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
                method: 'POST',
                body: { gara_id: idGara }
            });

            this.mostraNotifica("Iscrizione alla gara annullata.", "info");
            if (window.app.mieIscrizioniGare) {
                // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
                // Riceve: id (identificativo dell’elemento).
                window.app.mieIscrizioniGare = window.app.mieIscrizioniGare.filter(id => id !== idGara);
            }
            if (typeof this.caricaGare === 'function') this.caricaGare();
            this.caricaProfilo();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this.mostraNotifica(this.apiErrorMessage(error), "error");
        }
    }
});

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {
    // createProfileCourseCard: Costruisce la scheda di un corso a cui l’utente è iscritto.
    // Riceve: corso (dati del corso).
    createProfileCourseCard(corso) {
        // visual: Icona, categoria e tono grafico scelti per la scheda del catalogo.
        const visual = this.getCourseVisual?.(corso.nome || '') || { icon: '✦', tone: 'cyan' };
        // item: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const item = this.creaElemento('article', { className: 'profile-compact-card' });
        // icon: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const icon = this.creaElemento('span', {
            className: `sport-icon sport-icon-${visual.tone}`,
            text: visual.icon,
            attrs: { 'aria-hidden': 'true' }
        });
        // content: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const content = this.creaElemento('div', { className: 'profile-compact-content' });
        content.append(
            this.creaElemento('strong', { text: corso.nome || 'Corso senza nome' }),
            this.creaElemento('small', {
                text: `${this.formattaGiorno?.(corso.giorno) || 'Giorno da definire'} · ${this.formattaOrario?.(corso.orario_inizio) || corso.orario_inizio || '--:--'}`
            })
        );
        // action: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const action = this.creaElemento('button', {
            className: 'profile-compact-arrow',
            text: 'Disiscriviti',
            attrs: { type: 'button' }
        });
        // Esegue l’azione del controllo quando viene premuto. Chiede conferma, annulla l’iscrizione al corso e aggiorna
        // catalogo e profilo.
        action.addEventListener('click', () => this.disiscriviti(corso.id));
        item.append(icon, content, action);
        return item;
    },

    // createProfileRaceCard: Costruisce la scheda di una gara a cui l’utente è iscritto.
    // Riceve: gara (dati della gara).
    createProfileRaceCard(gara) {
        // visual: Icona, categoria e tono grafico scelti per la scheda del catalogo.
        const visual = this.getRaceVisual?.(gara.nome || '') || { icon: '🏆', tone: 'magenta' };
        // dataGara: Valore scelto tra i due rami in base alla condizione indicata.
        const dataGara = gara.giorno ? new Date(gara.giorno).toLocaleDateString('it-IT', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }) : 'Data da definire';
        // item: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const item = this.creaElemento('article', { className: 'profile-compact-card profile-race-card' });
        // icon: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const icon = this.creaElemento('span', {
            className: `sport-icon sport-icon-${visual.tone}`,
            text: visual.icon,
            attrs: { 'aria-hidden': 'true' }
        });
        // content: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const content = this.creaElemento('div', { className: 'profile-compact-content' });
        content.append(
            this.creaElemento('strong', { text: gara.nome || 'Gara senza nome' }),
            this.creaElemento('small', { text: `${dataGara} · ${this.formattaOrario?.(gara.orario) || gara.orario || '--:--'}` })
        );
        // action: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const action = this.creaElemento('button', {
            className: 'profile-compact-arrow',
            text: 'Ritirati',
            attrs: { type: 'button' }
        });
        // Esegue l’azione del controllo quando viene premuto. Chiede conferma, annulla l’iscrizione alla gara e aggiorna
        // l’interfaccia.
        action.addEventListener('click', () => this.disiscrivitiGara(gara.id));
        item.append(icon, content, action);
        return item;
    },

    // renderProfileCourses: Rappresenta le iscrizioni ai corsi oppure lo stato vuoto.
    // Riceve: corsi (elenco dei corsi).
    renderProfileCourses(corsi) {
        // container: Elemento DOM lista-mie-iscrizioni: Contenitore dell’interfaccia.
        const container = document.getElementById('lista-mie-iscrizioni');
        if (!container) return;
        this.svuotaElemento(container);

        if (!corsi.length) {
            this.renderProfileMessage(container, 'Non sei ancora iscritto a nessun corso.');
            return;
        }

        // grid: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const grid = this.creaElemento('div', { className: 'profile-compact-grid' });
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: corso (dati del corso).
        corsi.forEach(corso => grid.appendChild(this.createProfileCourseCard(corso)));
        container.appendChild(grid);
    },

    // renderProfileRaces: Rappresenta le iscrizioni alle gare oppure lo stato vuoto.
    // Riceve: gare (elenco delle gare).
    renderProfileRaces(gare) {
        // container: Elemento DOM lista-mie-gare: Contenitore dell’interfaccia.
        const container = document.getElementById('lista-mie-gare');
        if (!container) return;
        this.svuotaElemento(container);

        if (!gare.length) {
            this.renderProfileMessage(container, 'Non sei iscritto a nessuna gara.');
            return;
        }

        // grid: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const grid = this.creaElemento('div', { className: 'profile-compact-grid profile-race-grid' });
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: gara (dati della gara).
        gare.forEach(gara => grid.appendChild(this.createProfileRaceCard(gara)));
        container.appendChild(grid);
    }
});
