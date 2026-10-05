window.app = window.app || {};

Object.assign(window.app, {

    recaptchaWidgets: {},

    gestisciRecaptchaPronto() {
        this.recaptchaPronto = true;
        this.renderizzaRecaptchaVisibili();
    },

    idRecaptchaPerModale(idModale) {
        const mappa = {
            'modale-login': 'recaptcha-login',
            'modale-registrazione': 'recaptcha-registrazione'
        };

        return mappa[idModale];
    },

    usaRecaptchaLocale() {
        return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
    },

    preparaRecaptchaModale(idModale) {
        if (!this.idRecaptchaPerModale(idModale)) return;
        window.setTimeout(() => this.renderizzaRecaptcha(idModale), 80);
    },

    renderizzaRecaptchaVisibili() {
        ['modale-login', 'modale-registrazione'].forEach((idModale) => {
            const modale = document.getElementById(idModale);
            if (modale?.classList.contains('active')) {
                this.renderizzaRecaptcha(idModale);
            }
        });
    },

    renderizzaRecaptchaLocale(idModale) {
        const idElemento = this.idRecaptchaPerModale(idModale);
        const elemento = document.getElementById(idElemento);
        if (!elemento || elemento.querySelector('[data-recaptcha-locale="true"]')) return;

        const idCheckbox = `${idElemento}-locale`;
        const label = document.createElement('label');
        label.className = 'recaptcha-local-check';
        label.setAttribute('for', idCheckbox);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = idCheckbox;
        checkbox.dataset.recaptchaLocale = 'true';

        const box = document.createElement('span');
        box.className = 'recaptcha-local-box';
        box.setAttribute('aria-hidden', 'true');

        const testo = document.createElement('span');
        testo.className = 'recaptcha-local-text';
        testo.textContent = 'Non sono un robot';

        const badge = document.createElement('small');
        badge.textContent = 'Verifica locale';

        label.append(checkbox, box, testo, badge);
        elemento.replaceChildren(label);
    },

    renderizzaRecaptcha(idModale, tentativo = 0) {
        const idElemento = this.idRecaptchaPerModale(idModale);
        const elemento = document.getElementById(idElemento);
        const modale = document.getElementById(idModale);

        if (!idElemento || !elemento || !modale?.classList.contains('active')) return;

        if (this.usaRecaptchaLocale()) {
            this.renderizzaRecaptchaLocale(idModale);
            return;
        }

        if (typeof grecaptcha === 'undefined' || typeof grecaptcha.render !== 'function') {
            if (tentativo < 30) {
                window.setTimeout(() => this.renderizzaRecaptcha(idModale, tentativo + 1), 150);
            }
            return;
        }

        if (this.recaptchaWidgets[idModale] !== undefined) {
            this.resettaRecaptcha(idModale);
            return;
        }

        try {
            this.recaptchaWidgets[idModale] = grecaptcha.render(elemento, {
                sitekey: elemento.dataset.sitekey || window.RECAPTCHA_SITE_KEY
            });
        } catch (error) {
            const messaggio = String(error?.message || error);
            if (!messaggio.toLowerCase().includes('already been rendered')) {
                console.error('Errore reCAPTCHA:', error);
            }
        }
    },

    ottieniTokenRecaptcha(idModale) {
        if (this.usaRecaptchaLocale()) {
            const checkbox = document.querySelector(`#${idModale} [data-recaptcha-locale="true"]`);
            return checkbox?.checked ? 'local-dev-recaptcha-ok' : '';
        }

        const widgetId = this.recaptchaWidgets[idModale];

        if (typeof grecaptcha !== 'undefined' && typeof grecaptcha.getResponse === 'function' && widgetId !== undefined) {
            return grecaptcha.getResponse(widgetId);
        }

        return document.querySelector(`#${idModale} [name="g-recaptcha-response"]`)?.value || '';
    },

    resettaRecaptcha(idModale) {
        if (this.usaRecaptchaLocale()) {
            const checkbox = document.querySelector(`#${idModale} [data-recaptcha-locale="true"]`);
            if (checkbox) checkbox.checked = false;
            return;
        }

        const widgetId = this.recaptchaWidgets[idModale];

        if (typeof grecaptcha !== 'undefined' && typeof grecaptcha.reset === 'function' && widgetId !== undefined) {
            try {
                grecaptcha.reset(widgetId);
            } catch (error) {
                console.error('Errore reset reCAPTCHA:', error);
            }
        }
    },

    nascondiSplash() {
        setTimeout(() => {
            const loader = document.getElementById('loading-screen');
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => loader.style.display = 'none', 800);
            }
        }, 1200); 
    },

    aggiornaUINavbar(utente) {
        window.app.utenteCorrente = utente;
        window.app.mioRuolo = utente.ruolo;
        const containerSaluto = document.getElementById('container-saluto');
        const testoSaluto = document.getElementById('testo-saluto');
        
        if (containerSaluto && testoSaluto) {
            containerSaluto.classList.remove('hidden');
            testoSaluto.innerText = `👋 Ciao, ${utente.nome}`;
        }
        
        if (testoSaluto) testoSaluto.textContent = `Ciao, ${utente.nome}`;

        const profileButton = document.getElementById('btn-profilo');
        if (profileButton) profileButton.textContent = 'Area personale';

        document.querySelectorAll('.nome-nav').forEach(el => el.remove());
    },

    async controllaSeLoggato() {
        try {
            const dati = await this.apiRequest('/api/profilo');

            window.app.mioId = dati.utente.id;
            window.app.mieIscrizioniCorsi = dati.iscrizioni.map(c => c.id);
            window.app.mieIscrizioniGare = dati.iscrizioni_gare.map(g => g.id);

            this.aggiornaUINavbar(dati.utente);

            document.getElementById('btn-profilo')?.classList.remove('hidden');
            document.getElementById('btn-logout')?.classList.remove('hidden');
            document.getElementById('btn-login-nav')?.classList.add('hidden');
            document.getElementById('btn-registrati-nav')?.classList.add('hidden');
            document.getElementById('btn-login-home')?.classList.add('hidden');
            document.getElementById('btn-chat')?.classList.remove('hidden');

            if (typeof this.connettiChat === 'function') this.connettiChat();

            const isAdmin = dati.utente.ruolo === 'ADMIN';
            const isCoach = dati.utente.ruolo === 'COACH';
            document.getElementById('btn-admin')?.classList.toggle('hidden', !isAdmin);
            document.getElementById('btn-admin-profilo')?.classList.toggle('hidden', !isAdmin);
            document.getElementById('btn-coach')?.classList.toggle('hidden', !isCoach);
            document.getElementById('btn-coach-profilo')?.classList.toggle('hidden', !isCoach);
        } catch (error) {
            if (error.status !== 401) console.error('Controllo sessione fallito:', error);
            document.getElementById('btn-login-nav')?.classList.remove('hidden');
            document.getElementById('btn-registrati-nav')?.classList.remove('hidden');
            document.getElementById('btn-login-home')?.classList.remove('hidden');
        } finally {
            if(typeof this.nascondiSplash === 'function') this.nascondiSplash();
        }
    },

    async eseguiLogin() {
        const emailScritta = document.getElementById('input-email').value;
        const passwordScritta = document.getElementById('input-password').value;
        const recaptchaToken = this.ottieniTokenRecaptcha('modale-login');

        if (!emailScritta || !passwordScritta) return this.mostraNotifica("Inserisci email e password.", "warning");
        if (!recaptchaToken) return this.mostraNotifica("Completa la verifica anti-robot.", "warning");

        try {
            const risultato = await this.apiRequest('/api/login', {
                method: 'POST',
                body: { email: emailScritta, password: passwordScritta, recaptchaToken }
            });

            window.app.mioId = risultato.utente.id;
            window.app.mieIscrizioniCorsi = risultato.iscrizioni ? risultato.iscrizioni.map(c => c.id) : [];
            window.app.mieIscrizioniGare = risultato.iscrizioni_gare ? risultato.iscrizioni_gare.map(g => g.id) : [];
            document.getElementById('btn-login-nav')?.classList.add('hidden');
            document.getElementById('btn-registrati-nav')?.classList.add('hidden');

            this.chiudiModale('modale-login');
            if(typeof this.mostraNotifica === 'function') this.mostraNotifica("Bentornato, " + risultato.utente.nome + ".", "success");

            this.aggiornaUINavbar(risultato.utente);

            document.getElementById('btn-profilo')?.classList.remove('hidden');
            document.getElementById('btn-logout')?.classList.remove('hidden');
            document.getElementById('btn-login-nav')?.classList.add('hidden');
            document.getElementById('btn-registrati-nav')?.classList.add('hidden');
            document.getElementById('btn-login-home')?.classList.add('hidden');
            document.getElementById('btn-chat')?.classList.remove('hidden');

            if (typeof this.connettiChat === 'function') this.connettiChat();

            const isAdmin = risultato.utente.ruolo === 'ADMIN';
            const isCoach = risultato.utente.ruolo === 'COACH';
            document.getElementById('btn-admin')?.classList.toggle('hidden', !isAdmin);
            document.getElementById('btn-admin-profilo')?.classList.toggle('hidden', !isAdmin);
            document.getElementById('btn-coach')?.classList.toggle('hidden', !isCoach);
            document.getElementById('btn-coach-profilo')?.classList.toggle('hidden', !isCoach);

            this.resettaRecaptcha('modale-login');
            setTimeout(() => { this.naviga('profilo'); }, 500);
        } catch (error) {
            if(typeof this.mostraNotifica === 'function') this.mostraNotifica(this.apiErrorMessage(error), "error");
            this.resettaRecaptcha('modale-login');
        }
    },

    async registrati() {
        const nome = document.getElementById('reg-nome').value;
        const cognome = document.getElementById('reg-cognome').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        const recaptchaToken = this.ottieniTokenRecaptcha('modale-registrazione');

        if (!nome || !cognome || !email || !password) return this.mostraNotifica("Compila tutti i campi.", "warning");
        if (!recaptchaToken) return this.mostraNotifica("Completa la verifica anti-robot.", "warning");

        try {
            const risultato = await this.apiRequest('/api/registrati', {
                method: 'POST',
                body: { nome, cognome, email, password, recaptchaToken }
            });

            this.chiudiModale('modale-registrazione');
            if(typeof this.mostraNotifica === 'function') this.mostraNotifica(risultato.messaggio, "success");

            document.getElementById('reg-nome').value = '';
            document.getElementById('reg-cognome').value = '';
            document.getElementById('reg-email').value = '';
            document.getElementById('reg-password').value = '';

            this.resettaRecaptcha('modale-registrazione');
            setTimeout(() => { this.apriModale('modale-login'); }, 1500);
        } catch (error) {
            if(typeof this.mostraNotifica === 'function') this.mostraNotifica(this.apiErrorMessage(error), "error");
            this.resettaRecaptcha('modale-registrazione');
        }
    },

    async eseguiLogout() {
        try {
            await this.apiRequest('/api/logout', { method: 'POST' });
            window.location.reload(); 
        } catch (error) { 
            this.mostraNotifica?.(this.apiErrorMessage(error, 'Errore durante il logout.'), 'error');
        }
    }
});

if (typeof grecaptcha !== 'undefined' && typeof grecaptcha.render === 'function') {
    window.app.gestisciRecaptchaPronto?.();
}
