window.app = window.app || {};

Object.assign(window.app, {
    _setAdminBusy(buttonId, busy) {
        const button = document.getElementById(buttonId);
        if (!button) return;
        button.disabled = busy;
        button.classList.toggle('is-loading', busy);
        button.setAttribute('aria-busy', String(busy));
    },

    _notifyAdminError(error, fallback = 'Errore di connessione.') {
        const message = this.apiErrorMessage(error, fallback);
        this.mostraNotifica?.(message, 'error');
    },

    _normalizzaAdminTesto(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('it-IT')
            .trim();
    },

    _adminMatchesSearch(item, query, fields) {
        if (!query) return true;
        const searchableText = fields
            .map(field => typeof field === 'function' ? field(item) : item[field])
            .join(' ');
        return this._normalizzaAdminTesto(searchableText).includes(query);
    },

    _readAdminField(id) {
        return document.getElementById(id)?.value?.trim() || '';
    },

    _focusAdminField(id) {
        const field = document.getElementById(id);
        if (!field) return;
        field.focus({ preventScroll: true });
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    _validateRequiredAdminFields(fields) {
        const missing = fields.find(field => !this._readAdminField(field.id));
        if (!missing) return true;
        this.mostraNotifica?.(`${missing.label} è obbligatorio.`, 'warning');
        this._focusAdminField(missing.id);
        return false;
    },

    _highlightAdminElement(selector) {
        const element = document.querySelector(selector);
        if (!element) return;
        element.classList.remove('admin-highlight');
        void element.offsetWidth;
        element.classList.add('admin-highlight');
    },

    _openAdminForm(formId, focusId) {
        const form = document.getElementById(formId);
        if (!form) return;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this._highlightAdminElement(`#${formId}`);
        window.setTimeout(() => document.getElementById(focusId)?.focus({ preventScroll: true }), 280);
    },

    _setAdminCounter(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    },

    _resetAdminFields(ids) {
        ids.forEach(id => {
            const field = document.getElementById(id);
            if (field) field.value = '';
        });
    },

    _buildAdminFormData(fields, fileInputId) {
        const formData = new FormData();
        Object.entries(fields).forEach(([name, id]) => {
            formData.append(name, this._readAdminField(id));
        });
        const file = document.getElementById(fileInputId)?.files[0];
        if (file) formData.append('propic', file);
        return formData;
    },

    _formatAdminCurrency(value) {
        return Number(value || 0).toLocaleString('it-IT', {
            style: 'currency',
            currency: 'EUR'
        });
    },

    aggiornaRiepilogoAdmin() {
        const users = Array.isArray(this._utentiAdminCache) ? this._utentiAdminCache : null;
        const courses = Array.isArray(this._corsiAdminCache) ? this._corsiAdminCache : null;
        const races = Array.isArray(this._gareAdminCache) ? this._gareAdminCache : null;
        const cachedCoaches = Array.isArray(this._coachesAdminCache) ? this._coachesAdminCache : null;

        this._setAdminCounter('admin-count-utenti', users ? users.length : '--');
        this._setAdminCounter(
            'admin-count-coach',
            users
                ? users.filter(user => user.ruolo === 'COACH').length
                : (cachedCoaches ? cachedCoaches.length : '--')
        );
        this._setAdminCounter('admin-count-corsi', courses ? courses.length : '--');
        this._setAdminCounter('admin-count-gare', races ? races.length : '--');
    },

    async caricaGestioneUtenti() {
        const container = document.getElementById('tabella-utenti');
        this.mostraStatoAdmin(container, 'Caricamento utenti...');
        try {
            const users = await this.adminApi.listUsers();
            this._utentiAdminCache = users;
            this.aggiornaRiepilogoAdmin();
            this.renderAdminUtenti();
        } catch (error) {
            this.mostraStatoAdmin(
                container,
                error.status === 403
                    ? 'Non hai i permessi per vedere questa sezione.'
                    : this.apiErrorMessage(error, 'Errore nel caricamento utenti.'),
                'error'
            );
        }
    },

    renderAdminUtenti() {
        const container = document.getElementById('tabella-utenti');
        const users = this._utentiAdminCache || [];
        const query = this._normalizzaAdminTesto(document.getElementById('admin-search-utenti')?.value);

        if (!users.length) {
            this.mostraStatoAdmin(container, 'Nessun utente disponibile.');
            return;
        }

        const roleLabels = {
            PARTNER: 'iscritto',
            COACH: 'coach',
            ADMIN: 'admin'
        };
        const filteredUsers = users.filter(user => this._adminMatchesSearch(user, query, [
            'nome',
            'cognome',
            'email',
            'ruolo',
            user => roleLabels[user.ruolo] || ''
        ]));

        if (!filteredUsers.length) {
            this.mostraStatoAdmin(container, 'Nessun utente corrisponde alla ricerca.');
            return;
        }

        const list = this.creaElemento('ul', { className: 'admin-user-list' });
        filteredUsers.forEach(user => list.appendChild(this.creaRigaUtenteAdmin(user)));
        container?.replaceChildren(list);
    },

    async adminSalvaModifiche(userId) {
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
            const result = await this.adminApi.updateUser(userId, payload);
            this.mostraNotifica?.(result.messaggio, 'success');
            await this.caricaGestioneUtenti();
            this._highlightAdminElement(`[data-admin-user-id="${userId}"]`);
        } catch (error) {
            this._notifyAdminError(error);
        }
    },

    async adminResetPropic(userId) {
        const confirmed = await this.confermaAzione({
            titolo: 'Rimuovere la foto?',
            messaggio: 'La foto del profilo verrà sostituita con quella predefinita.',
            testoConferma: 'Rimuovi foto'
        });
        if (!confirmed) return;

        try {
            const result = await this.adminApi.resetUserPicture(userId);
            this.mostraNotifica?.(result.messaggio, 'success');
            await this.caricaGestioneUtenti();
        } catch (error) {
            this._notifyAdminError(error);
        }
    },

    async adminEliminaUtente(userId) {
        const confirmed = await this.confermaAzione({
            titolo: 'Eliminare questo utente?',
            messaggio: 'L’account e i dati collegati verranno rimossi definitivamente.',
            testoConferma: 'Elimina utente',
            tipo: 'danger'
        });
        if (!confirmed) return;

        try {
            const result = await this.adminApi.deleteUser(userId);
            this.mostraNotifica?.(result.messaggio, 'success');
            await this.caricaGestioneUtenti();
        } catch (error) {
            this._notifyAdminError(error);
        }
    },

    async caricaTendinaCoaches() {
        const select = document.getElementById('admin-corso-coach');
        if (!select) return;

        try {
            const coaches = await this.adminApi.listCoaches();
            this._coachesAdminCache = coaches;
            this.aggiornaRiepilogoAdmin();
            const fragment = document.createDocumentFragment();
            fragment.appendChild(this.creaElemento('option', {
                text: 'Seleziona un coach o istruttore...',
                attrs: { value: '' }
            }));
            coaches.forEach(coach => {
                fragment.appendChild(this.creaElemento('option', {
                    text: `${coach.nome || ''} ${coach.cognome || ''}`.trim(),
                    attrs: { value: coach.id }
                }));
            });
            select.replaceChildren(fragment);
        } catch (error) {
            this._notifyAdminError(error, 'Errore caricamento coach.');
        }
    },

    _creaRigaEntitaAdmin({ id, kind, title, meta, editAction, deleteAction, deleteLabel }) {
        const item = this.creaElemento('li', {
            className: 'admin-entity-row',
            attrs: {
                'data-admin-entity-id': id,
                'data-admin-kind': kind
            }
        });
        const content = this.creaElemento('div', { className: 'admin-entity-content' });
        content.append(
            this.creaElemento('strong', { text: title }),
            this.creaElemento('span', { className: 'admin-entity-meta', text: meta })
        );
        const actions = this.creaElemento('div', { className: 'admin-entity-actions' });
        actions.append(
            this.creaAdminButton('Modifica', 'is-warning', editAction, `Modifica ${title}`),
            this.creaAdminButton('Elimina', 'is-danger', deleteAction, deleteLabel)
        );
        item.append(content, actions);
        return item;
    },

    async caricaAdminCorsi() {
        const container = document.getElementById('admin-lista-corsi');
        this.mostraStatoAdmin(container, 'Caricamento corsi...');
        try {
            const courses = await this.adminApi.listCourses();
            this._corsiAdminCache = courses;
            this.aggiornaRiepilogoAdmin();
            this.renderAdminCorsi();
        } catch (error) {
            this.mostraStatoAdmin(container, this.apiErrorMessage(error, 'Errore caricamento corsi.'), 'error');
        }
    },

    renderAdminCorsi() {
        const container = document.getElementById('admin-lista-corsi');
        const courses = this._corsiAdminCache || [];
        const query = this._normalizzaAdminTesto(document.getElementById('admin-search-corsi')?.value);

        if (!courses.length) {
            this.mostraStatoAdmin(container, 'Nessun corso disponibile.');
            return;
        }

        const filteredCourses = courses.filter(course => this._adminMatchesSearch(course, query, [
            'nome',
            'giorno',
            'bio',
            course => `${course.coach_nome || ''} ${course.coach_cognome || ''}`
        ]));

        if (!filteredCourses.length) {
            this.mostraStatoAdmin(container, 'Nessun corso corrisponde alla ricerca.');
            return;
        }

        const list = this.creaElemento('ul', { className: 'admin-entity-list' });
        filteredCourses.forEach(course => {
            const giorno = this.formattaGiorno?.(course.giorno, 'Giorno da definire') || 'Giorno da definire';
            const orario = course.orario_inizio || 'orario da definire';
            const durata = course.durata ? `${course.durata} min` : 'durata non indicata';
            const costo = this._formatAdminCurrency(course.costo);
            const coach = `${course.coach_nome || ''} ${course.coach_cognome || ''}`.trim() || 'coach non assegnato';
            list.appendChild(this._creaRigaEntitaAdmin({
                id: course.id,
                kind: 'course',
                title: course.nome || 'Corso senza nome',
                meta: `${giorno} alle ${orario} · ${durata} · ${costo} · ${coach}`,
                editAction: () => this.adminPreparaModifica(course.id),
                deleteAction: () => this.adminEliminaCorso(course.id),
                deleteLabel: `Elimina corso ${course.nome || ''}`
            }));
        });
        container?.replaceChildren(list);
    },

    adminPreparaModifica(courseId) {
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

    async adminSalvaCorso() {
        const courseId = document.getElementById('admin-corso-id')?.value;
        const requiredOk = this._validateRequiredAdminFields([
            { id: 'admin-corso-nome', label: 'Il nome del corso' },
            { id: 'admin-corso-giorno', label: 'Il giorno del corso' },
            { id: 'admin-corso-orario', label: 'L’orario del corso' },
            { id: 'admin-corso-durata', label: 'La durata del corso' }
        ]);
        if (!requiredOk) return;

        this._setAdminBusy('btn-salva-corso', true);
        try {
            const result = await this.adminApi.saveCourse(courseId, this._buildCourseFormData());
            this.mostraNotifica?.(result.messaggio, 'success');
            this.adminAnnullaModifica();
            await this.caricaAdminCorsi();
            if (courseId) this._highlightAdminElement(`[data-admin-kind="course"][data-admin-entity-id="${courseId}"]`);
        } catch (error) {
            this._notifyAdminError(error, 'Errore salvataggio corso.');
        } finally {
            this._setAdminBusy('btn-salva-corso', false);
        }
    },

    async adminEliminaCorso(courseId) {
        const confirmed = await this.confermaAzione({
            titolo: 'Eliminare questo corso?',
            messaggio: 'Il corso verrà cancellato definitivamente insieme ai collegamenti con gli iscritti.',
            testoConferma: 'Elimina corso',
            tipo: 'danger'
        });
        if (!confirmed) return;

        try {
            const result = await this.adminApi.deleteCourse(courseId);
            this.mostraNotifica?.(result.messaggio, 'success');
            await this.caricaAdminCorsi();
        } catch (error) {
            this._notifyAdminError(error);
        }
    },

    async caricaAdminGare() {
        const container = document.getElementById('admin-lista-gare');
        this.mostraStatoAdmin(container, 'Caricamento gare...');
        try {
            const races = await this.adminApi.listRaces();
            this._gareAdminCache = races;
            this.aggiornaRiepilogoAdmin();
            this.renderAdminGare();
        } catch (error) {
            this.mostraStatoAdmin(container, this.apiErrorMessage(error, 'Errore caricamento gare.'), 'error');
        }
    },

    renderAdminGare() {
        const container = document.getElementById('admin-lista-gare');
        const races = this._gareAdminCache || [];
        const query = this._normalizzaAdminTesto(document.getElementById('admin-search-gare')?.value);

        if (!races.length) {
            this.mostraStatoAdmin(container, 'Nessuna gara disponibile.');
            return;
        }

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

        const list = this.creaElemento('ul', { className: 'admin-entity-list' });
        filteredRaces.forEach(race => {
            const raceDate = race.giorno
                ? new Date(race.giorno).toLocaleDateString('it-IT')
                : 'data da definire';
            const orario = race.orario || 'orario da definire';
            const costo = this._formatAdminCurrency(race.costo);
            list.appendChild(this._creaRigaEntitaAdmin({
                id: race.id,
                kind: 'race',
                title: race.nome || 'Gara senza nome',
                meta: `${raceDate} alle ${orario} · ${costo}`,
                editAction: () => this.adminPreparaModificaGara(race.id),
                deleteAction: () => this.adminEliminaGara(race.id),
                deleteLabel: `Elimina gara ${race.nome || ''}`
            }));
        });
        container?.replaceChildren(list);
    },

    adminPreparaModificaGara(raceId) {
        const race = this._gareAdminCache?.find(item => item.id === raceId);
        if (!race) return;

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

    _buildRaceFormData() {
        return this._buildAdminFormData({
            nome: 'admin-gara-nome',
            giorno: 'admin-gara-giorno',
            orario: 'admin-gara-orario',
            costo: 'admin-gara-costo',
            bio: 'admin-gara-bio'
        }, 'admin-gara-img');
    },

    async adminSalvaGara() {
        const raceId = document.getElementById('admin-gara-id')?.value;
        const isEditing = Boolean(raceId);
        if (!this._validateRequiredAdminFields([
            { id: 'admin-gara-nome', label: 'nome della gara' },
            { id: 'admin-gara-giorno', label: 'data' },
            { id: 'admin-gara-orario', label: 'orario' }
        ])) return;

        this._setAdminBusy('btn-salva-gara', true);
        try {
            const result = await this.adminApi.saveRace(raceId, this._buildRaceFormData());
            this.mostraNotifica?.(result.messaggio, 'success');
            this.adminAnnullaModificaGara();
            await this.caricaAdminGare();
            if (isEditing) this._highlightAdminElement(`[data-admin-kind="race"][data-admin-entity-id="${raceId}"]`);
        } catch (error) {
            this._notifyAdminError(error, 'Errore salvataggio gara.');
        } finally {
            this._setAdminBusy('btn-salva-gara', false);
        }
    },

    async adminEliminaGara(raceId) {
        const confirmed = await this.confermaAzione({
            titolo: 'Eliminare questa gara?',
            messaggio: 'L’evento verrà annullato per tutti gli iscritti.',
            testoConferma: 'Elimina gara',
            tipo: 'danger'
        });
        if (!confirmed) return;

        try {
            const result = await this.adminApi.deleteRace(raceId);
            this.mostraNotifica?.(result.messaggio, 'success');
            await this.caricaAdminGare();
        } catch (error) {
            this._notifyAdminError(error);
        }
    },

    _aggiornaStatisticheCoach(courses = []) {
        const list = Array.isArray(courses) ? courses : [];
        const enrolledTotal = list.reduce((total, course) => {
            return total + (Array.isArray(course.iscritti) ? course.iscritti.length : 0);
        }, 0);

        this._setAdminCounter('coach-count-corsi', list.length);
        this._setAdminCounter('coach-count-iscritti', enrolledTotal);
    },

    _corsoCoachVisibile(course, query) {
        if (!query) return true;
        const giorno = this.formattaGiorno?.(course.giorno, course.giorno || '') || course.giorno || '';
        const studenti = Array.isArray(course.iscritti) ? course.iscritti : [];
        const searchText = [
            course.nome,
            giorno,
            course.orario,
            ...studenti.flatMap(studente => [
                studente.nome,
                studente.cognome,
                studente.email
            ])
        ].join(' ');

        return this._normalizzaAdminTesto(searchText).includes(query);
    },

    _renderAreaCoach(courses = []) {
        const container = document.getElementById('coach-lista-corsi');
        const list = Array.isArray(courses) ? courses : [];
        const query = this._normalizzaAdminTesto(
            document.getElementById('coach-search-registro')?.value || ''
        );
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

        const fragment = document.createDocumentFragment();
        filtered.forEach(course => fragment.appendChild(this.creaSchedaCorsoCoach(course)));
        container?.replaceChildren(fragment);
    },

    filtraAreaCoach() {
        this._renderAreaCoach(this._coachCourses || []);
    },

    async caricaAreaCoach() {
        const container = document.getElementById('coach-lista-corsi');
        this._aggiornaStatisticheCoach([]);
        this.mostraStatoAdmin(container, 'Caricamento registro...');
        try {
            const courses = await this.adminApi.listCoachCourses();
            this._coachCourses = Array.isArray(courses) ? courses : [];
            this._renderAreaCoach(this._coachCourses);
        } catch (error) {
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
