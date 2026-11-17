// Frontend: coordina caricamenti, ricerca, form e operazioni dell’amministratore e del coach.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
window.app = window.app || {};

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {
    // _setAdminBusy: Aggiorna lo stato occupato del pulsante per evitare invii ripetuti durante una richiesta.
    // Riceve: buttonId (id del pulsante); busy (se l’operazione è in corso).
    _setAdminBusy(buttonId, busy) {
        // button: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const button = document.getElementById(buttonId);
        if (!button) return;
        button.disabled = busy;
        button.classList.toggle('is-loading', busy);
        button.setAttribute('aria-busy', String(busy));
    },

    // _notifyAdminError: Mostra un errore amministrativo utilizzando il messaggio disponibile o il testo di ripiego.
    // Riceve: error (errore intercettato); fallback (valore o messaggio di ripiego).
    _notifyAdminError(error, fallback = 'Errore di connessione.') {
        // message: Messaggio di stato o contenuto da rappresentare.
        const message = this.apiErrorMessage(error, fallback);
        this.mostraNotifica?.(message, 'error');
    },

    // _normalizzaAdminTesto: Normalizza il testo per rendere coerente la ricerca nelle liste amministrative.
    // Riceve: value (valore da elaborare).
    _normalizzaAdminTesto(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('it-IT')
            .trim();
    },

    // _adminMatchesSearch: Verifica se i campi indicati dell’elemento corrispondono al testo cercato.
    // Riceve: item (elemento corrente); query (testo cercato o istruzione da eseguire); fields (campi usati dal
    // confronto o dal form).
    _adminMatchesSearch(item, query, fields) {
        if (!query) return true;
        // searchableText: Risultato della chiamata fields.map.join, riutilizzato nelle istruzioni successive.
        const searchableText = fields
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: field (nome del campo).
            .map(field => typeof field === 'function' ? field(item) : item[field])
            .join(' ');
        return this._normalizzaAdminTesto(searchableText).includes(query);
    },

    // _readAdminField: Legge il valore del campo amministrativo identificato dall’id.
    // Riceve: id (identificativo dell’elemento).
    _readAdminField(id) {
        return document.getElementById(id)?.value?.trim() || '';
    },

    // _focusAdminField: Porta il focus sul campo indicato, se presente nel DOM.
    // Riceve: id (identificativo dell’elemento).
    _focusAdminField(id) {
        // field: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const field = document.getElementById(id);
        if (!field) return;
        field.focus({ preventScroll: true });
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    // _validateRequiredAdminFields: Trova e segnala il primo campo obbligatorio non compilato.
    // Riceve: fields (campi usati dal confronto o dal form).
    _validateRequiredAdminFields(fields) {
        // missing: Primo elemento della raccolta che soddisfa il criterio richiesto.
        // Restituisce il criterio per individuare il primo elemento corrispondente.
        // Riceve: field (nome del campo).
        const missing = fields.find(field => !this._readAdminField(field.id));
        if (!missing) return true;
        this.mostraNotifica?.(`${missing.label} è obbligatorio.`, 'warning');
        this._focusAdminField(missing.id);
        return false;
    },

    // _highlightAdminElement: Evidenzia temporaneamente l’elemento a cui l’utente deve prestare attenzione.
    // Riceve: selector (selettore CSS del componente).
    _highlightAdminElement(selector) {
        // element: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const element = document.querySelector(selector);
        if (!element) return;
        element.classList.remove('admin-highlight');
        void element.offsetWidth;
        element.classList.add('admin-highlight');
    },

    // _openAdminForm: Mostra il form richiesto e prepara il focus sul campo iniziale.
    // Riceve: formId (id del form); focusId (id del campo da focalizzare).
    _openAdminForm(formId, focusId) {
        // form: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const form = document.getElementById(formId);
        if (!form) return;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._highlightAdminElement(`#${formId}`);
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        window.setTimeout(() => document.getElementById(focusId)?.focus({ preventScroll: true }), 280);
    },

    // _setAdminCounter: Aggiorna il contatore amministrativo con un valore leggibile.
    // Riceve: id (identificativo dell’elemento); value (valore da elaborare).
    _setAdminCounter(id, value) {
        // element: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    },

    // _resetAdminFields: Svuota o ripristina i campi del form individuati dall’elenco di id.
    // Riceve: ids (elenco degli identificativi).
    _resetAdminFields(ids) {
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: id (identificativo dell’elemento).
        ids.forEach(id => {
            // field: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
            const field = document.getElementById(id);
            if (field) field.value = '';
        });
    },

    // _buildAdminFormData: Raccoglie campi e immagine in FormData per una richiesta multipart.
    // Riceve: fields (campi usati dal confronto o dal form); fileInputId (id del campo file).
    _buildAdminFormData(fields, fileInputId) {
        // formData: Contenitore multipart per campi del form e file binari.
        const formData = new FormData();
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: name (nome da utilizzare); id (identificativo dell’elemento).
        Object.entries(fields).forEach(([name, id]) => {
            formData.append(name, this._readAdminField(id));
        });
        // file: File selezionati nel controllo del form.
        const file = document.getElementById(fileInputId)?.files[0];
        if (file) formData.append('propic', file);
        return formData;
    },

    // _formatAdminCurrency: Formatta il costo secondo la rappresentazione monetaria prevista dall’interfaccia.
    // Riceve: value (valore da elaborare).
    _formatAdminCurrency(value) {
        return Number(value || 0).toLocaleString('it-IT', {
            style: 'currency',
            currency: 'EUR'
        });
    },

    // aggiornaRiepilogoAdmin: Ricalcola i contatori del pannello usando i dati amministrativi già caricati.
    aggiornaRiepilogoAdmin() {
        // users: Elenco degli utenti restituiti dal caricamento.
        const users = Array.isArray(this._utentiAdminCache) ? this._utentiAdminCache : null;
        // courses: Elenco dei corsi recuperati o filtrati.
        const courses = Array.isArray(this._corsiAdminCache) ? this._corsiAdminCache : null;
        // races: Elenco delle gare recuperate o filtrate.
        const races = Array.isArray(this._gareAdminCache) ? this._gareAdminCache : null;
        // cachedCoaches: Valore scelto tra i due rami in base alla condizione indicata.
        const cachedCoaches = Array.isArray(this._coachesAdminCache) ? this._coachesAdminCache : null;

        this._setAdminCounter('admin-count-utenti', users ? users.length : '--');
        this._setAdminCounter(
            'admin-count-coach',
            users
                // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
                // Riceve: user (dati dell’utente).
                ? users.filter(user => user.ruolo === 'COACH').length
                : (cachedCoaches ? cachedCoaches.length : '--')
        );
        this._setAdminCounter('admin-count-corsi', courses ? courses.length : '--');
        this._setAdminCounter('admin-count-gare', races ? races.length : '--');
    },

    // caricaGestioneUtenti: Carica gli utenti dal backend e prepara elenco, filtri e riepiloghi.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaGestioneUtenti() {
        // container: Elemento DOM tabella-utenti: Contenitore dell’interfaccia.
        const container = document.getElementById('tabella-utenti');
        this.mostraStatoAdmin(container, 'Caricamento utenti...');
        try {
            // users: Elenco degli utenti restituiti dal caricamento.
            const users = await this.adminApi.listUsers();
            this._utentiAdminCache = users;
            this.aggiornaRiepilogoAdmin();
            this.renderAdminUtenti();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this.mostraStatoAdmin(
                container,
                error.status === 403
                    ? 'Non hai i permessi per vedere questa sezione.'
                    : this.apiErrorMessage(error, 'Errore nel caricamento utenti.'),
                'error'
            );
        }
    },

    // renderAdminUtenti: Applica i filtri correnti e ricostruisce la lista amministrativa degli utenti.
    renderAdminUtenti() {
        // container: Elemento DOM tabella-utenti: Contenitore dell’interfaccia.
        const container = document.getElementById('tabella-utenti');
        // users: Elenco degli utenti restituiti dal caricamento.
        const users = this._utentiAdminCache || [];
        // query: Valore letto dal campo HTML da validare o inviare.
        const query = this._normalizzaAdminTesto(document.getElementById('admin-search-utenti')?.value);

        if (!users.length) {
            this.mostraStatoAdmin(container, 'Nessun utente disponibile.');
            return;
        }

        // roleLabels: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const roleLabels = {
            PARTNER: 'iscritto',
            COACH: 'coach',
            ADMIN: 'admin'
        };
        // filteredUsers: Elementi della raccolta che superano il criterio di selezione.
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: user (dati dell’utente).
        const filteredUsers = users.filter(user => this._adminMatchesSearch(user, query, [
            'nome',
            'cognome',
            'email',
            'ruolo',
            // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
            // Riceve: user (dati dell’utente).
            user => roleLabels[user.ruolo] || ''
        ]));

        if (!filteredUsers.length) {
            this.mostraStatoAdmin(container, 'Nessun utente corrisponde alla ricerca.');
            return;
        }

        // list: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const list = this.creaElemento('ul', { className: 'admin-user-list' });
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: user (dati dell’utente).
        filteredUsers.forEach(user => list.appendChild(this.creaRigaUtenteAdmin(user)));
        container?.replaceChildren(list);
    },

    // adminSalvaModifiche: Valida e invia le modifiche dell’utente, aggiornando l’interfaccia dopo la risposta.
    // Riceve: userId (id dell’utente).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async adminSalvaModifiche(userId) {
        // payload: Valore letto dal campo HTML da validare o inviare.
        const payload = {
            nome: document.getElementById(`admin-nome-${userId}`)?.value.trim(),
            cognome: document.getElementById(`admin-cognome-${userId}`)?.value.trim(),
            eta: document.getElementById(`admin-eta-${userId}`)?.value,
            ruolo: document.getElementById(`ruolo-${userId}`)?.value,
            bio: document.getElementById(`bio-${userId}`)?.value,
            certificato_scadenza: document.getElementById(`admin-scadenza-${userId}`)?.value || null
        };

        if (!payload.nome || !payload.cognome) {
            this.mostraNotifica?.('Nome e cognome non possono essere vuoti.', 'warning');
            return;
        }

        try {
            // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            const result = await this.adminApi.updateUser(userId, payload);
            this.mostraNotifica?.(result.messaggio, 'success');
            await this.caricaGestioneUtenti();
            this._highlightAdminElement(`[data-admin-user-id="${userId}"]`);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this._notifyAdminError(error);
        }
    },

    // adminResetPropic: Chiede conferma e ripristina l’immagine predefinita dell’utente.
    // Riceve: userId (id dell’utente).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async adminResetPropic(userId) {
        // confirmed: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const confirmed = await this.confermaAzione({
            titolo: 'Rimuovere la foto?',
            messaggio: 'La foto del profilo verrà sostituita con quella predefinita.',
            testoConferma: 'Rimuovi foto'
        });
        if (!confirmed) return;

        try {
            // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            const result = await this.adminApi.resetUserPicture(userId);
            this.mostraNotifica?.(result.messaggio, 'success');
            await this.caricaGestioneUtenti();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this._notifyAdminError(error);
        }
    },

    // adminEliminaUtente: Chiede conferma ed elimina l’utente tramite l’API amministrativa.
    // Riceve: userId (id dell’utente).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async adminEliminaUtente(userId) {
        // confirmed: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const confirmed = await this.confermaAzione({
            titolo: 'Eliminare questo utente?',
            messaggio: 'L’account e i dati collegati verranno rimossi definitivamente.',
            testoConferma: 'Elimina utente',
            tipo: 'danger'
        });
        if (!confirmed) return;

        try {
            // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            const result = await this.adminApi.deleteUser(userId);
            this.mostraNotifica?.(result.messaggio, 'success');
            await this.caricaGestioneUtenti();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this._notifyAdminError(error);
        }
    },

    // caricaTendinaCoaches: Carica e popola le opzioni dei coach assegnabili a un corso.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaTendinaCoaches() {
        // select: Elemento DOM admin-corso-coach: Menu di scelta.
        const select = document.getElementById('admin-corso-coach');
        if (!select) return;

        try {
            // coaches: Elenco dei coach disponibili.
            const coaches = await this.adminApi.listCoaches();
            this._coachesAdminCache = coaches;
            this.aggiornaRiepilogoAdmin();
            // fragment: Frammento DOM che raccoglie i nodi prima del loro inserimento nel documento.
            const fragment = document.createDocumentFragment();
            fragment.appendChild(this.creaElemento('option', {
                text: 'Seleziona un coach o istruttore...',
                attrs: { value: '' }
            }));
            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: coach (dati del coach).
            coaches.forEach(coach => {
                fragment.appendChild(this.creaElemento('option', {
                    text: `${coach.nome || ''} ${coach.cognome || ''}`.trim(),
                    attrs: { value: coach.id }
                }));
            });
            select.replaceChildren(fragment);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this._notifyAdminError(error, 'Errore caricamento coach.');
        }
    },

    // _creaRigaEntitaAdmin: Costruisce una riga riutilizzabile per corsi o gare con informazioni e azioni.
    // Riceve: id (identificativo dell’elemento); kind (tipo di entità da rappresentare); title (titolo della riga);
    // meta (informazioni sintetiche della riga); editAction (funzione per la modifica); deleteAction (funzione per
    // l’eliminazione); deleteLabel (etichetta del pulsante di eliminazione).
    _creaRigaEntitaAdmin({ id, kind, title, meta, editAction, deleteAction, deleteLabel }) {
        // item: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const item = this.creaElemento('li', {
            className: 'admin-entity-row',
            attrs: {
                'data-admin-entity-id': id,
                'data-admin-kind': kind
            }
        });
        // content: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const content = this.creaElemento('div', { className: 'admin-entity-content' });
        content.append(
            this.creaElemento('strong', { text: title }),
            this.creaElemento('span', { className: 'admin-entity-meta', text: meta })
        );
        // actions: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const actions = this.creaElemento('div', { className: 'admin-entity-actions' });
        actions.append(
            this.creaAdminButton('Modifica', 'is-warning', editAction, `Modifica ${title}`),
            this.creaAdminButton('Elimina', 'is-danger', deleteAction, deleteLabel)
        );
        item.append(content, actions);
        return item;
    },

    // caricaAdminCorsi: Carica il catalogo dei corsi per il pannello amministrativo.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaAdminCorsi() {
        // container: Elemento DOM admin-lista-corsi: Contenitore dell’interfaccia.
        const container = document.getElementById('admin-lista-corsi');
        this.mostraStatoAdmin(container, 'Caricamento corsi...');
        try {
            // courses: Elenco dei corsi recuperati o filtrati.
            const courses = await this.adminApi.listCourses();
            this._corsiAdminCache = courses;
            this.aggiornaRiepilogoAdmin();
            this.renderAdminCorsi();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this.mostraStatoAdmin(container, this.apiErrorMessage(error, 'Errore caricamento corsi.'), 'error');
        }
    },

    // renderAdminCorsi: Filtra e rappresenta i corsi nella lista amministrativa.
    renderAdminCorsi() {
        // container: Elemento DOM admin-lista-corsi: Contenitore dell’interfaccia.
        const container = document.getElementById('admin-lista-corsi');
        // courses: Elenco dei corsi recuperati o filtrati.
        const courses = this._corsiAdminCache || [];
        // query: Valore letto dal campo HTML da validare o inviare.
        const query = this._normalizzaAdminTesto(document.getElementById('admin-search-corsi')?.value);

        if (!courses.length) {
            this.mostraStatoAdmin(container, 'Nessun corso disponibile.');
            return;
        }

        // filteredCourses: Elementi della raccolta che superano il criterio di selezione.
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: course (dati del corso).
        const filteredCourses = courses.filter(course => this._adminMatchesSearch(course, query, [
            'nome',
            'giorno',
            'bio',
            // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
            // Riceve: course (dati del corso).
            course => `${course.coach_nome || ''} ${course.coach_cognome || ''}`
        ]));

        if (!filteredCourses.length) {
            this.mostraStatoAdmin(container, 'Nessun corso corrisponde alla ricerca.');
            return;
        }

        // list: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const list = this.creaElemento('ul', { className: 'admin-entity-list' });
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: course (dati del corso).
        filteredCourses.forEach(course => {
            // giorno: Giorno o data formattati per l’interfaccia.
            const giorno = this.formattaGiorno?.(course.giorno, 'Giorno da definire') || 'Giorno da definire';
            // orario: Orario formattato per l’interfaccia.
            const orario = course.orario_inizio || 'orario da definire';
            // durata: Valore scelto tra i due rami in base alla condizione indicata.
            const durata = course.durata ? `${course.durata} min` : 'durata non indicata';
            // costo: Risultato di _formatAdminCurrency. Formatta il costo secondo la rappresentazione monetaria prevista
            // dall’interfaccia.
            const costo = this._formatAdminCurrency(course.costo);
            // coach: Informazione del coach assegnato, usata nella rappresentazione del corso.
            const coach = `${course.coach_nome || ''} ${course.coach_cognome || ''}`.trim() || 'coach non assegnato';
            list.appendChild(this._creaRigaEntitaAdmin({
                id: course.id,
                kind: 'course',
                title: course.nome || 'Corso senza nome',
                meta: `${giorno} alle ${orario} · ${durata} · ${costo} · ${coach}`,
                // editAction: Avvia la modifica dell’entità rappresentata dalla riga amministrativa.
                editAction: () => this.adminPreparaModifica(course.id),
                // deleteAction: Avvia la richiesta di eliminazione dell’entità rappresentata dalla riga amministrativa.
                deleteAction: () => this.adminEliminaCorso(course.id),
                deleteLabel: `Elimina corso ${course.nome || ''}`
            }));
        });
        container?.replaceChildren(list);
    },

    // adminPreparaModifica: Carica nei campi il corso scelto e passa il form alla modalità modifica.
    // Riceve: courseId (id del corso).
    adminPreparaModifica(courseId) {
        // course: Dati del corso corrente.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: item (elemento corrente).
        const course = this._corsiAdminCache?.find(item => item.id === courseId);
        if (!course) return;

        document.getElementById('admin-corso-id').value = course.id;
        document.getElementById('admin-corso-nome').value = course.nome || '';
        document.getElementById('admin-corso-giorno').value = course.giorno || '';
        document.getElementById('admin-corso-orario').value = course.orario_inizio || '';
        document.getElementById('admin-corso-durata').value = course.durata || '';
        document.getElementById('admin-corso-costo').value = course.costo || '';
        document.getElementById('admin-corso-bio').value = course.bio || '';
        document.getElementById('admin-corso-coach').value = course.coach_id || '';

        document.getElementById('titolo-modulo-corso').textContent = `Modifica corso: ${course.nome}`;
        document.getElementById('btn-salva-corso').textContent = 'Salva modifiche';
        document.getElementById('btn-salva-corso').classList.add('is-editing');
        document.getElementById('btn-annulla-corso').classList.remove('hidden');
        this._openAdminForm('admin-form-corsi', 'admin-corso-nome');
    },

    // adminAnnullaModifica: Ripristina il form del corso e termina la modalità modifica.
    adminAnnullaModifica() {
        this._resetAdminFields([
            'admin-corso-id',
            'admin-corso-nome',
            'admin-corso-giorno',
            'admin-corso-orario',
            'admin-corso-durata',
            'admin-corso-costo',
            'admin-corso-bio',
            'admin-corso-coach',
            'admin-corso-img'
        ]);

        document.getElementById('titolo-modulo-corso').textContent = 'Aggiungi un nuovo corso';
        document.getElementById('btn-salva-corso').textContent = 'Crea corso';
        document.getElementById('btn-salva-corso').classList.remove('is-editing');
        document.getElementById('btn-annulla-corso').classList.add('hidden');
    },

    // _buildCourseFormData: Raccoglie i campi e la copertina del corso da inviare al backend.
    _buildCourseFormData() {
        return this._buildAdminFormData({
            nome: 'admin-corso-nome',
            giorno: 'admin-corso-giorno',
            orario_inizio: 'admin-corso-orario',
            durata: 'admin-corso-durata',
            costo: 'admin-corso-costo',
            bio: 'admin-corso-bio',
            coach_id: 'admin-corso-coach'
        }, 'admin-corso-img');
    },

    // adminSalvaCorso: Valida e salva il corso in creazione o modifica.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async adminSalvaCorso() {
        // courseId: Valore letto dal campo HTML da validare o inviare.
        const courseId = document.getElementById('admin-corso-id')?.value;
        // requiredOk: Risultato di _validateRequiredAdminFields. Trova e segnala il primo campo obbligatorio non
        // compilato.
        const requiredOk = this._validateRequiredAdminFields([
            { id: 'admin-corso-nome', label: 'Il nome del corso' },
            { id: 'admin-corso-giorno', label: 'Il giorno del corso' },
            { id: 'admin-corso-orario', label: 'L’orario del corso' },
            { id: 'admin-corso-durata', label: 'La durata del corso' }
        ]);
        if (!requiredOk) return;

        this._setAdminBusy('btn-salva-corso', true);
        try {
            // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            const result = await this.adminApi.saveCourse(courseId, this._buildCourseFormData());
            this.mostraNotifica?.(result.messaggio, 'success');
            this.adminAnnullaModifica();
            await this.caricaAdminCorsi();
            if (courseId) this._highlightAdminElement(`[data-admin-kind="course"][data-admin-entity-id="${courseId}"]`);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this._notifyAdminError(error, 'Errore salvataggio corso.');
        } finally {
            this._setAdminBusy('btn-salva-corso', false);
        }
    },

    // adminEliminaCorso: Chiede conferma ed elimina il corso, poi aggiorna l’elenco.
    // Riceve: courseId (id del corso).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async adminEliminaCorso(courseId) {
        // confirmed: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const confirmed = await this.confermaAzione({
            titolo: 'Eliminare questo corso?',
            messaggio: 'Il corso verrà cancellato definitivamente insieme ai collegamenti con gli iscritti.',
            testoConferma: 'Elimina corso',
            tipo: 'danger'
        });
        if (!confirmed) return;

        try {
            // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            const result = await this.adminApi.deleteCourse(courseId);
            this.mostraNotifica?.(result.messaggio, 'success');
            await this.caricaAdminCorsi();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this._notifyAdminError(error);
        }
    },

    // caricaAdminGare: Carica le gare per il pannello amministrativo.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaAdminGare() {
        // container: Elemento DOM admin-lista-gare: Contenitore dell’interfaccia.
        const container = document.getElementById('admin-lista-gare');
        this.mostraStatoAdmin(container, 'Caricamento gare...');
        try {
            // races: Elenco delle gare recuperate o filtrate.
            const races = await this.adminApi.listRaces();
            this._gareAdminCache = races;
            this.aggiornaRiepilogoAdmin();
            this.renderAdminGare();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this.mostraStatoAdmin(container, this.apiErrorMessage(error, 'Errore caricamento gare.'), 'error');
        }
    },

    // renderAdminGare: Filtra e rappresenta le gare nella lista amministrativa.
    renderAdminGare() {
        // container: Elemento DOM admin-lista-gare: Contenitore dell’interfaccia.
        const container = document.getElementById('admin-lista-gare');
        // races: Elenco delle gare recuperate o filtrate.
        const races = this._gareAdminCache || [];
        // query: Valore letto dal campo HTML da validare o inviare.
        const query = this._normalizzaAdminTesto(document.getElementById('admin-search-gare')?.value);

        if (!races.length) {
            this.mostraStatoAdmin(container, 'Nessuna gara disponibile.');
            return;
        }

        // filteredRaces: Elementi della raccolta che superano il criterio di selezione.
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: race (dati della gara).
        const filteredRaces = races.filter(race => this._adminMatchesSearch(race, query, [
            'nome',
            'giorno',
            'orario',
            'bio'
        ]));

        if (!filteredRaces.length) {
            this.mostraStatoAdmin(container, 'Nessuna gara corrisponde alla ricerca.');
            return;
        }

        // list: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const list = this.creaElemento('ul', { className: 'admin-entity-list' });
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: race (dati della gara).
        filteredRaces.forEach(race => {
            // raceDate: Valore scelto tra i due rami in base alla condizione indicata.
            const raceDate = race.giorno
                ? new Date(race.giorno).toLocaleDateString('it-IT')
                : 'data da definire';
            // orario: Orario formattato per l’interfaccia.
            const orario = race.orario || 'orario da definire';
            // costo: Risultato di _formatAdminCurrency. Formatta il costo secondo la rappresentazione monetaria prevista
            // dall’interfaccia.
            const costo = this._formatAdminCurrency(race.costo);
            list.appendChild(this._creaRigaEntitaAdmin({
                id: race.id,
                kind: 'race',
                title: race.nome || 'Gara senza nome',
                meta: `${raceDate} alle ${orario} · ${costo}`,
                // editAction: Avvia la modifica dell’entità rappresentata dalla riga amministrativa.
                editAction: () => this.adminPreparaModificaGara(race.id),
                // deleteAction: Avvia la richiesta di eliminazione dell’entità rappresentata dalla riga amministrativa.
                deleteAction: () => this.adminEliminaGara(race.id),
                deleteLabel: `Elimina gara ${race.nome || ''}`
            }));
        });
        container?.replaceChildren(list);
    },

    // adminPreparaModificaGara: Compila il form con la gara selezionata per modificarla.
    // Riceve: raceId (id della gara).
    adminPreparaModificaGara(raceId) {
        // race: Dati della gara corrente.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: item (elemento corrente).
        const race = this._gareAdminCache?.find(item => item.id === raceId);
        if (!race) return;

        // dateValue: Valore scelto tra i due rami in base alla condizione indicata.
        const dateValue = race.giorno
            ? (String(race.giorno).includes('T')
                ? String(race.giorno).split('T')[0]
                : new Date(race.giorno).toISOString().split('T')[0])
            : '';

        document.getElementById('admin-gara-id').value = race.id;
        document.getElementById('admin-gara-nome').value = race.nome || '';
        document.getElementById('admin-gara-giorno').value = dateValue;
        document.getElementById('admin-gara-orario').value = race.orario || '';
        document.getElementById('admin-gara-costo').value = race.costo || '';
        document.getElementById('admin-gara-bio').value = race.bio || '';
        document.getElementById('titolo-modulo-gara').textContent = `Modifica gara: ${race.nome}`;
        document.getElementById('btn-salva-gara').textContent = 'Salva modifiche';
        document.getElementById('btn-salva-gara').classList.add('is-editing');
        document.getElementById('btn-annulla-gara').classList.remove('hidden');
        this._openAdminForm('admin-form-gare', 'admin-gara-nome');
    },

    // adminAnnullaModificaGara: Svuota il form della gara e termina la modifica corrente.
    adminAnnullaModificaGara() {
        this._resetAdminFields([
            'admin-gara-id',
            'admin-gara-nome',
            'admin-gara-giorno',
            'admin-gara-orario',
            'admin-gara-costo',
            'admin-gara-bio',
            'admin-gara-img'
        ]);

        document.getElementById('titolo-modulo-gara').textContent = 'Aggiungi una nuova gara';
        document.getElementById('btn-salva-gara').textContent = 'Crea gara';
        document.getElementById('btn-salva-gara').classList.remove('is-editing');
        document.getElementById('btn-annulla-gara').classList.add('hidden');
    },

    // _buildRaceFormData: Raccoglie i campi e la copertina della gara per l’invio multipart.
    _buildRaceFormData() {
        return this._buildAdminFormData({
            nome: 'admin-gara-nome',
            giorno: 'admin-gara-giorno',
            orario: 'admin-gara-orario',
            costo: 'admin-gara-costo',
            bio: 'admin-gara-bio'
        }, 'admin-gara-img');
    },

    // adminSalvaGara: Valida e salva la gara in creazione o modifica.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async adminSalvaGara() {
        // raceId: Valore letto dal campo HTML da validare o inviare.
        const raceId = document.getElementById('admin-gara-id')?.value;
        // isEditing: Indicatore booleano che controlla la condizione descritta dal nome.
        const isEditing = Boolean(raceId);
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (!this._validateRequiredAdminFields([
            { id: 'admin-gara-nome', label: 'nome della gara' },
            { id: 'admin-gara-giorno', label: 'data' },
            { id: 'admin-gara-orario', label: 'orario' }
        ])) return;

        this._setAdminBusy('btn-salva-gara', true);
        try {
            // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            const result = await this.adminApi.saveRace(raceId, this._buildRaceFormData());
            this.mostraNotifica?.(result.messaggio, 'success');
            this.adminAnnullaModificaGara();
            await this.caricaAdminGare();
            if (isEditing) this._highlightAdminElement(`[data-admin-kind="race"][data-admin-entity-id="${raceId}"]`);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this._notifyAdminError(error, 'Errore salvataggio gara.');
        } finally {
            this._setAdminBusy('btn-salva-gara', false);
        }
    },

    // adminEliminaGara: Chiede conferma ed elimina la gara, aggiornando il catalogo.
    // Riceve: raceId (id della gara).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async adminEliminaGara(raceId) {
        // confirmed: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const confirmed = await this.confermaAzione({
            titolo: 'Eliminare questa gara?',
            messaggio: 'L’evento verrà annullato per tutti gli iscritti.',
            testoConferma: 'Elimina gara',
            tipo: 'danger'
        });
        if (!confirmed) return;

        try {
            // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            const result = await this.adminApi.deleteRace(raceId);
            this.mostraNotifica?.(result.messaggio, 'success');
            await this.caricaAdminGare();
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this._notifyAdminError(error);
        }
    },

    // _aggiornaStatisticheCoach: Aggiorna i contatori dell’area coach usando corsi e iscritti caricati.
    // Riceve: courses (elenco dei corsi).
    _aggiornaStatisticheCoach(courses = []) {
        // list: Valore scelto tra i due rami in base alla condizione indicata.
        const list = Array.isArray(courses) ? courses : [];
        // enrolledTotal: Risultato accumulato scorrendo gli elementi della raccolta.
        // Aggiorna il valore accumulato usando l’elemento corrente.
        // Riceve: total (valore accumulato); course (dati del corso).
        const enrolledTotal = list.reduce((total, course) => {
            return total + (Array.isArray(course.iscritti) ? course.iscritti.length : 0);
        }, 0);

        this._setAdminCounter('coach-count-corsi', list.length);
        this._setAdminCounter('coach-count-iscritti', enrolledTotal);
    },

    // _corsoCoachVisibile: Verifica se corso o iscritti corrispondono al filtro di ricerca del coach.
    // Riceve: course (dati del corso); query (testo cercato o istruzione da eseguire).
    _corsoCoachVisibile(course, query) {
        if (!query) return true;
        // giorno: Giorno o data formattati per l’interfaccia.
        const giorno = this.formattaGiorno?.(course.giorno, course.giorno || '') || course.giorno || '';
        // studenti: Valore scelto tra i due rami in base alla condizione indicata.
        const studenti = Array.isArray(course.iscritti) ? course.iscritti : [];
        // searchText: Risultato della chiamata .join, riutilizzato nelle istruzioni successive.
        const searchText = [
            course.nome,
            giorno,
            course.orario,
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: studente (dati dello studente).
            ...studenti.flatMap(studente => [
                studente.nome,
                studente.cognome,
                studente.email
            ])
        ].join(' ');

        return this._normalizzaAdminTesto(searchText).includes(query);
    },

    // _renderAreaCoach: Ricostruisce le schede dell’area coach rispettando il filtro corrente.
    // Riceve: courses (elenco dei corsi).
    _renderAreaCoach(courses = []) {
        // container: Elemento DOM coach-lista-corsi: Contenitore dell’interfaccia.
        const container = document.getElementById('coach-lista-corsi');
        // list: Valore scelto tra i due rami in base alla condizione indicata.
        const list = Array.isArray(courses) ? courses : [];
        // query: Valore letto dal campo HTML da validare o inviare.
        const query = this._normalizzaAdminTesto(
            document.getElementById('coach-search-registro')?.value || ''
        );
        // filtered: Elementi della raccolta che superano il criterio di selezione.
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: course (dati del corso).
        const filtered = list.filter(course => this._corsoCoachVisibile(course, query));

        this._aggiornaStatisticheCoach(list);

        if (!list.length) {
            this.mostraStatoAdmin(container, 'Non hai ancora corsi assegnati.');
            return;
        }

        if (!filtered.length) {
            this.mostraStatoAdmin(container, 'Nessun corso o iscritto corrisponde alla ricerca.');
            return;
        }

        // fragment: Frammento DOM che raccoglie i nodi prima del loro inserimento nel documento.
        const fragment = document.createDocumentFragment();
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: course (dati del corso).
        filtered.forEach(course => fragment.appendChild(this.creaSchedaCorsoCoach(course)));
        container?.replaceChildren(fragment);
    },

    // filtraAreaCoach: Rappresenta nuovamente l’area coach applicando il testo cercato.
    filtraAreaCoach() {
        this._renderAreaCoach(this._coachCourses || []);
    },

    // caricaAreaCoach: Richiede al backend i corsi gestiti dal coach e aggiorna la relativa sezione.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async caricaAreaCoach() {
        // container: Elemento DOM coach-lista-corsi: Contenitore dell’interfaccia.
        const container = document.getElementById('coach-lista-corsi');
        this._aggiornaStatisticheCoach([]);
        this.mostraStatoAdmin(container, 'Caricamento registro...');
        try {
            // courses: Elenco dei corsi recuperati o filtrati.
            const courses = await this.adminApi.listCoachCourses();
            this._coachCourses = Array.isArray(courses) ? courses : [];
            this._renderAreaCoach(this._coachCourses);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this._coachCourses = [];
            this._aggiornaStatisticheCoach([]);
            this.mostraStatoAdmin(
                container,
                error.status === 403
                    ? 'Accesso non autorizzato. Accedi come coach.'
                    : this.apiErrorMessage(error, 'Errore caricamento area coach.'),
                'error'
            );
        }
    }
});
