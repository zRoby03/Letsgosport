window.app = window.app || {};

Object.assign(window.app, {
    creaAdminButton(label, className, handler, ariaLabel = label) {
        const button = this.creaElemento('button', {
            className: `admin-action-btn ${className}`,
            text: label,
            attrs: { type: 'button', 'aria-label': ariaLabel }
        });
        button.addEventListener('click', handler);
        return button;
    },

    creaAdminInput({ id, type = 'text', value = '', placeholder = '', className = '', attrs = {} }) {
        return this.creaElemento('input', {
            className: `admin-field ${className}`.trim(),
            attrs: { id, type, value, placeholder, ...attrs }
        });
    },

    mostraStatoAdmin(container, message, type = '') {
        if (!container) return;
        container.replaceChildren(this.creaElemento('p', {
            className: `admin-list-state${type ? ` is-${type}` : ''}`,
            text: message,
            attrs: { role: type === 'error' ? 'alert' : 'status' }
        }));
    },

    creaRigaUtenteAdmin(utente) {
        const roleLabels = {
            PARTNER: 'Iscritto',
            COACH: 'Coach',
            ADMIN: 'Admin'
        };
        const fullName = `${utente.nome || ''} ${utente.cognome || ''}`.trim() || 'utente';
        const userRole = utente.ruolo || 'PARTNER';
        const item = this.creaElemento('li', {
            className: 'admin-user-row',
            attrs: { 'data-admin-user-id': utente.id }
        });
        const header = this.creaElemento('div', { className: 'admin-user-header' });
        const identity = this.creaElemento('div', { className: 'admin-user-identity' });
        const avatar = this.creaElemento('img', {
            className: 'admin-user-avatar',
            attrs: {
                src: this.uploadSrc(utente.propic),
                alt: `Foto di ${fullName}`,
                loading: 'lazy'
            }
        });
        const identityData = this.creaElemento('div', { className: 'admin-user-data' });
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

        const actions = this.creaElemento('div', { className: 'admin-user-actions' });
        const roleSelect = this.creaElemento('select', {
            className: 'admin-field admin-role-select',
            attrs: { id: `ruolo-${utente.id}` }
        });
        [
            ['PARTNER', 'Iscritto'],
            ['COACH', 'Coach'],
            ['ADMIN', 'Admin']
        ].forEach(([value, label]) => {
            const option = this.creaElemento('option', { text: label, attrs: { value } });
            option.selected = userRole === value;
            roleSelect.appendChild(option);
        });
        actions.append(
            this.creaAdminButton('Reset foto', 'is-warning', () => this.adminResetPropic(utente.id), `Rimuovi la foto di ${fullName}`),
            roleSelect,
            this.creaAdminButton('Salva', 'is-success', () => this.adminSalvaModifiche(utente.id), `Salva modifiche di ${fullName}`),
            this.creaAdminButton('Cancella', 'is-danger', () => this.adminEliminaUtente(utente.id), `Cancella ${fullName}`)
        );
        header.append(identity, actions);

        const bio = this.creaAdminInput({
            id: `bio-${utente.id}`,
            value: utente.bio || '',
            placeholder: 'Biografia breve',
            className: 'admin-field-bio',
            attrs: { 'aria-label': `Biografia di ${fullName}` }
        });

        const certificate = this.creaElemento('div', { className: 'admin-certificate-box' });
        const parsedCertificateDate = utente.certificato_scadenza
            ? new Date(utente.certificato_scadenza)
            : null;
        const certificateDate = parsedCertificateDate && !Number.isNaN(parsedCertificateDate.getTime())
            ? parsedCertificateDate
            : null;
        const certificateValid = certificateDate && certificateDate > new Date();
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
        const certificateControls = this.creaElemento('div', { className: 'admin-certificate-controls' });
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

    creaRigaStudenteCoach(studente, corsoId) {
        const fullName = `${studente.nome || ''} ${studente.cognome || ''}`.trim() || 'Iscritto';
        const row = this.creaElemento('div', { className: 'coach-student-row' });
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
        const openProfile = () => this.apriMiniProfilo(
            fullName,
            this.uploadSrc(studente.propic),
            studente.bio || '',
            studente.ruolo || 'PARTNER',
            studente.eta || '--',
            `corso_${corsoId}`
        );
        image.addEventListener('click', openProfile);
        image.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openProfile();
            }
        });
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

    creaSchedaCorsoCoach(corso) {
        const card = this.creaElemento('section', { className: 'coach-course-card' });
        const giorno = this.formattaGiorno?.(corso.giorno, 'Da definire') || corso.giorno || 'Da definire';
        const iscritti = Array.isArray(corso.iscritti) ? corso.iscritti : [];
        const header = this.creaElemento('div', { className: 'coach-course-heading' });
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

        const students = this.creaElemento('div', { className: 'coach-student-list' });
        iscritti.forEach(studente => {
            students.appendChild(this.creaRigaStudenteCoach(studente, corso.id));
        });
        card.appendChild(students);
        return card;
    }
});
