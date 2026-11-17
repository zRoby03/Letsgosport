// Frontend: costruisce righe e schede di amministrazione e area coach con elementi DOM.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
window.app = window.app || {};

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {
    // creaAdminButton: Crea un pulsante DOM con testo, classi e azione associata, senza costruire HTML dai dati
    // dell’utente.
    // Riceve: label (testo dell’etichetta); className (classi CSS da applicare); handler (funzione che gestisce
    // l’azione); ariaLabel (etichetta per le tecnologie assistive).
    // Restituisce il pulsante pronto da inserire nel contenitore.
    creaAdminButton(label, className, handler, ariaLabel = label) {
        // button: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const button = this.creaElemento('button', {
            className: `admin-action-btn ${className}`,
            text: label,
            attrs: { type: 'button', 'aria-label': ariaLabel }
        });
        button.addEventListener('click', handler);
        return button;
    },

    // creaAdminInput: Crea e configura un campo del form amministrativo a partire dai valori ricevuti.
    // Riceve: id (identificativo dell’elemento); type (tipo previsto); value (valore da elaborare); placeholder (testo
    // di esempio del campo); className (classi CSS da applicare); attrs (attributi HTML da applicare).
    // Restituisce il campo DOM configurato.
    creaAdminInput({ id, type = 'text', value = '', placeholder = '', className = '', attrs = {} }) {
        return this.creaElemento('input', {
            className: `admin-field ${className}`.trim(),
            attrs: { id, type, value, placeholder, ...attrs }
        });
    },

    // mostraStatoAdmin: Mostra un messaggio di caricamento, assenza di dati o errore nel contenitore amministrativo.
    // Riceve: container (contenitore del DOM); message (testo del messaggio); type (tipo previsto).
    mostraStatoAdmin(container, message, type = '') {
        if (!container) return;
        container.replaceChildren(this.creaElemento('p', {
            className: `admin-list-state${type ? ` is-${type}` : ''}`,
            text: message,
            attrs: { role: type === 'error' ? 'alert' : 'status' }
        }));
    },

    // creaRigaUtenteAdmin: Costruisce la riga modificabile dell’utente con campi e pulsanti amministrativi.
    // Riceve: utente (dati dell’utente).
    creaRigaUtenteAdmin(utente) {
        // roleLabels: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const roleLabels = {
            PARTNER: 'Iscritto',
            COACH: 'Coach',
            ADMIN: 'Admin'
        };
        // fullName: Nome e cognome uniti per la visualizzazione della persona.
        const fullName = `${utente.nome || ''} ${utente.cognome || ''}`.trim() || 'utente';
        // userRole: Ruolo della persona normalizzato per la rappresentazione della riga.
        const userRole = utente.ruolo || 'PARTNER';
        // item: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const item = this.creaElemento('li', {
            className: 'admin-user-row',
            attrs: { 'data-admin-user-id': utente.id }
        });
        // header: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const header = this.creaElemento('div', { className: 'admin-user-header' });
        // identity: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const identity = this.creaElemento('div', { className: 'admin-user-identity' });
        // avatar: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const avatar = this.creaElemento('img', {
            className: 'admin-user-avatar',
            attrs: {
                src: this.uploadSrc(utente.propic),
                alt: `Foto di ${fullName}`,
                loading: 'lazy'
            }
        });
        // identityData: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const identityData = this.creaElemento('div', { className: 'admin-user-data' });
        // nameFields: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const nameFields = this.creaElemento('div', { className: 'admin-user-name-fields' });
        nameFields.append(
            this.creaAdminInput({
                id: `admin-nome-${utente.id}`,
                value: utente.nome || '',
                placeholder: 'Nome',
                className: 'admin-field-name',
                attrs: { 'aria-label': `Nome di ${fullName}` }
            }),
            this.creaAdminInput({
                id: `admin-cognome-${utente.id}`,
                value: utente.cognome || '',
                placeholder: 'Cognome',
                className: 'admin-field-name',
                attrs: { 'aria-label': `Cognome di ${fullName}` }
            }),
            this.creaAdminInput({
                id: `admin-eta-${utente.id}`,
                type: 'number',
                value: utente.eta || '',
                placeholder: 'Età',
                className: 'admin-field-age',
                attrs: { min: 1, max: 120, 'aria-label': `Età di ${fullName}` }
            })
        );
        // meta: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const meta = this.creaElemento('div', { className: 'admin-user-meta' });
        meta.append(
            this.creaElemento('span', { className: 'admin-user-email', text: utente.email || 'Email non disponibile' }),
            this.creaElemento('span', {
                className: `admin-role-badge is-${String(userRole).toLowerCase()}`,
                text: roleLabels[userRole] || userRole
            })
        );
        identityData.append(
            nameFields,
            meta
        );
        identity.append(avatar, identityData);

        // actions: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const actions = this.creaElemento('div', { className: 'admin-user-actions' });
        // roleSelect: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const roleSelect = this.creaElemento('select', {
            className: 'admin-field admin-role-select',
            attrs: { id: `ruolo-${utente.id}` }
        });
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: value (valore da elaborare); label (testo dell’etichetta).
        [
            ['PARTNER', 'Iscritto'],
            ['COACH', 'Coach'],
            ['ADMIN', 'Admin']
        ].forEach(([value, label]) => {
            // option: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const option = this.creaElemento('option', { text: label, attrs: { value } });
            option.selected = userRole === value;
            roleSelect.appendChild(option);
        });
        actions.append(
            // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
            this.creaAdminButton('Reset foto', 'is-warning', () => this.adminResetPropic(utente.id), `Rimuovi la foto di ${fullName}`),
            roleSelect,
            // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
            this.creaAdminButton('Salva', 'is-success', () => this.adminSalvaModifiche(utente.id), `Salva modifiche di ${fullName}`),
            // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
            this.creaAdminButton('Cancella', 'is-danger', () => this.adminEliminaUtente(utente.id), `Cancella ${fullName}`)
        );
        header.append(identity, actions);

        // bio: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const bio = this.creaAdminInput({
            id: `bio-${utente.id}`,
            value: utente.bio || '',
            placeholder: 'Biografia breve',
            className: 'admin-field-bio',
            attrs: { 'aria-label': `Biografia di ${fullName}` }
        });

        // certificate: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const certificate = this.creaElemento('div', { className: 'admin-certificate-box' });
        // parsedCertificateDate: Valore scelto tra i due rami in base alla condizione indicata.
        const parsedCertificateDate = utente.certificato_scadenza
            ? new Date(utente.certificato_scadenza)
            : null;
        // certificateDate: Valore scelto tra i due rami in base alla condizione indicata.
        const certificateDate = parsedCertificateDate && !Number.isNaN(parsedCertificateDate.getTime())
            ? parsedCertificateDate
            : null;
        // certificateValid: Esito del controllo locale sullo stato del certificato.
        const certificateValid = certificateDate && certificateDate > new Date();
        // certificateStatus: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const certificateStatus = this.creaElemento('span', {
            className: `admin-certificate-status ${certificateValid ? 'is-valid' : 'is-invalid'}`
        });
        certificateStatus.append(
            this.creaElemento('strong', { text: 'Certificato ' }),
            document.createTextNode(
                certificateDate
                    ? `${certificateValid ? 'valido fino al' : 'scaduto il'} ${certificateDate.toLocaleDateString('it-IT')}`
                    : 'mancante'
            )
        );
        // certificateControls: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const certificateControls = this.creaElemento('div', { className: 'admin-certificate-controls' });
        // dateInput: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const dateInput = this.creaAdminInput({
            id: `admin-scadenza-${utente.id}`,
            type: 'date',
            value: certificateDate ? certificateDate.toISOString().split('T')[0] : '',
            className: 'admin-field-date',
            attrs: { 'aria-label': `Scadenza certificato di ${fullName}` }
        });
        certificateControls.append(
            this.creaElemento('label', {
                className: 'admin-field-label',
                text: 'Scadenza:',
                attrs: { for: `admin-scadenza-${utente.id}` }
            }),
            dateInput,
            this.creaElemento('span', {
                className: 'admin-save-hint',
                text: 'Modifica la data e salva il profilo.'
            })
        );
        certificate.append(certificateStatus, certificateControls);
        item.append(header, bio, certificate);
        return item;
    },

    // creaRigaStudenteCoach: Costruisce la voce di uno studente iscritto con accesso al profilo e alle azioni
    // previste.
    // Riceve: studente (dati dello studente); corsoId (id del corso).
    creaRigaStudenteCoach(studente, corsoId) {
        // fullName: Nome e cognome uniti per la visualizzazione della persona.
        const fullName = `${studente.nome || ''} ${studente.cognome || ''}`.trim() || 'Iscritto';
        // row: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const row = this.creaElemento('div', { className: 'coach-student-row' });
        // image: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const image = this.creaElemento('img', {
            className: 'coach-student-avatar',
            attrs: {
                src: this.uploadSrc(studente.propic),
                alt: `Foto di ${fullName}`,
                title: 'Vedi scheda',
                loading: 'lazy',
                role: 'button',
                tabindex: '0'
            }
        });
        // data: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const data = this.creaElemento('div', { className: 'coach-student-data' });
        data.append(
            this.creaElemento('div', {
                className: 'coach-student-name',
                text: fullName
            }),
            this.creaElemento('div', {
                className: 'coach-student-email',
                text: studente.email || 'Email non disponibile'
            })
        );
        // tags: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const tags = this.creaElemento('div', { className: 'coach-student-tags' });
        tags.append(
            this.creaElemento('span', {
                text: studente.eta ? `${studente.eta} anni` : 'Età non indicata'
            }),
            this.creaElemento('span', {
                text: studente.ruolo === 'COACH' ? 'Coach' : 'Iscritto'
            })
        );
        data.appendChild(tags);
        // openProfile: Apre il profilo rapido della persona rappresentata dalla voce dell’interfaccia.
        const openProfile = () => this.apriMiniProfilo(
            fullName,
            this.uploadSrc(studente.propic),
            studente.bio || '',
            studente.ruolo || 'PARTNER',
            studente.eta || '--',
            `corso_${corsoId}`
        );
        image.addEventListener('click', openProfile);
        // Gestisce i tasti premuti, rispettando le condizioni controllate nel blocco.
        // Riceve: event (evento del browser).
        image.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openProfile();
            }
        });
        // button: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const button = this.creaElemento('button', {
            className: 'coach-student-action',
            text: 'Apri scheda',
            attrs: {
                type: 'button',
                'aria-label': `Apri scheda di ${fullName}`
            }
        });
        button.addEventListener('click', openProfile);
        row.append(image, data, button);
        return row;
    },

    // creaSchedaCorsoCoach: Costruisce una scheda del corso gestito dal coach con la lista degli iscritti.
    // Riceve: corso (dati del corso).
    creaSchedaCorsoCoach(corso) {
        // card: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const card = this.creaElemento('section', { className: 'coach-course-card' });
        // giorno: Giorno o data formattati per l’interfaccia.
        const giorno = this.formattaGiorno?.(corso.giorno, 'Da definire') || corso.giorno || 'Da definire';
        // iscritti: Elenco delle persone iscritte al corso.
        const iscritti = Array.isArray(corso.iscritti) ? corso.iscritti : [];
        // header: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const header = this.creaElemento('div', { className: 'coach-course-heading' });
        // titleBlock: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const titleBlock = this.creaElemento('div', { className: 'coach-course-title-block' });
        titleBlock.append(
            this.creaElemento('span', {
                className: 'coach-course-kicker',
                text: 'Corso assegnato'
            }),
            this.creaElemento('h3', {
                className: 'coach-course-title',
                text: corso.nome || 'Corso'
            })
        );
        header.append(
            titleBlock,
            this.creaElemento('span', {
                className: 'coach-course-count',
                text: `${iscritti.length} ${iscritti.length === 1 ? 'iscritto' : 'iscritti'}`
            })
        );
        // schedule: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const schedule = this.creaElemento('div', { className: 'coach-course-schedule' });
        schedule.append(
            this.creaElemento('span', { text: `Giorno: ${giorno}` }),
            this.creaElemento('span', { text: `Orario: ${corso.orario || 'Da definire'}` })
        );
        card.append(
            header,
            schedule,
            this.creaElemento('h4', {
                className: 'coach-course-students-title',
                text: 'Iscritti al corso'
            })
        );

        if (iscritti.length === 0) {
            card.appendChild(this.creaElemento('p', {
                className: 'coach-empty-state',
                text: 'Nessun allievo si è ancora iscritto a questo corso.'
            }));
            return card;
        }

        // students: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const students = this.creaElemento('div', { className: 'coach-student-list' });
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: studente (dati dello studente).
        iscritti.forEach(studente => {
            students.appendChild(this.creaRigaStudenteCoach(studente, corso.id));
        });
        card.appendChild(students);
        return card;
    }
});
