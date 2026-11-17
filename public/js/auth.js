// Frontend: gestisce form di accesso e registrazione, widget reCAPTCHA e interfaccia dell’utente autenticato.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
window.app = window.app || {};

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {

    // recaptchaWidgets: Associa ogni contenitore all’identificativo del widget reCAPTCHA creato.
    recaptchaWidgets: {},

    // gestisciRecaptchaPronto: Riprende la preparazione dei widget quando lo script esterno reCAPTCHA è pronto.
    gestisciRecaptchaPronto() {
        this.recaptchaPronto = true;
        this.renderizzaRecaptchaVisibili();
    },

    // idRecaptchaPerModale: Associa la modale di accesso o registrazione al contenitore del relativo widget.
    // Riceve: idModale (id della finestra modale).
    idRecaptchaPerModale(idModale) {
        // mappa: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
        const mappa = {
            'modale-login': 'recaptcha-login',
            'modale-registrazione': 'recaptcha-registrazione'
        };

        return mappa[idModale];
    },

    // usaRecaptchaLocale: Indica se il frontend sta usando la modalità locale prevista per lo sviluppo.
    usaRecaptchaLocale() {
        return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
    },

    // preparaRecaptchaModale: Prepara il widget della modale, aspettando gli elementi o lo script quando necessario.
    // Riceve: idModale (id della finestra modale).
    preparaRecaptchaModale(idModale) {
        if (!this.idRecaptchaPerModale(idModale)) return;
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        window.setTimeout(() => this.renderizzaRecaptcha(idModale), 80);
    },

    // renderizzaRecaptchaVisibili: Prepara i widget reCAPTCHA delle modali attualmente visibili.
    renderizzaRecaptchaVisibili() {
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: idModale (id della finestra modale).
        ['modale-login', 'modale-registrazione'].forEach((idModale) => {
            // modale: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
            const modale = document.getElementById(idModale);
            if (modale?.classList.contains('active')) {
                this.renderizzaRecaptcha(idModale);
            }
        });
    },

    // renderizzaRecaptchaLocale: Costruisce il controllo locale utilizzato nell’ambiente di sviluppo previsto.
    // Riceve: idModale (id della finestra modale).
    renderizzaRecaptchaLocale(idModale) {
        // idElemento: Risultato di idRecaptchaPerModale. Associa la modale di accesso o registrazione al contenitore del
        // relativo widget.
        const idElemento = this.idRecaptchaPerModale(idModale);
        // elemento: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const elemento = document.getElementById(idElemento);
        if (!elemento || elemento.querySelector('[data-recaptcha-locale="true"]')) return;

        // idCheckbox: Identificativo del controllo locale associato alla modale reCAPTCHA.
        const idCheckbox = `${idElemento}-locale`;
        // label: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const label = document.createElement('label');
        label.className = 'recaptcha-local-check';
        label.setAttribute('for', idCheckbox);

        // checkbox: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = idCheckbox;
        checkbox.dataset.recaptchaLocale = 'true';

        // box: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const box = document.createElement('span');
        box.className = 'recaptcha-local-box';
        box.setAttribute('aria-hidden', 'true');

        // testo: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const testo = document.createElement('span');
        testo.className = 'recaptcha-local-text';
        testo.textContent = 'Non sono un robot';

        // badge: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const badge = document.createElement('small');
        badge.textContent = 'Verifica locale';

        label.append(checkbox, box, testo, badge);
        elemento.replaceChildren(label);
    },

    // renderizzaRecaptcha: Crea il widget Google nel contenitore corretto e gestisce i tentativi di preparazione.
    // Riceve: idModale (id della finestra modale); tentativo (numero del tentativo di preparazione).
    renderizzaRecaptcha(idModale, tentativo = 0) {
        // idElemento: Risultato di idRecaptchaPerModale. Associa la modale di accesso o registrazione al contenitore del
        // relativo widget.
        const idElemento = this.idRecaptchaPerModale(idModale);
        // elemento: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const elemento = document.getElementById(idElemento);
        // modale: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const modale = document.getElementById(idModale);

        if (!idElemento || !elemento || !modale?.classList.contains('active')) return;

        if (this.usaRecaptchaLocale()) {
            this.renderizzaRecaptchaLocale(idModale);
            return;
        }

        if (typeof grecaptcha === 'undefined' || typeof grecaptcha.render !== 'function') {
            if (tentativo < 30) {
                // Esegue l’azione alla scadenza del temporizzatore previsto.
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
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            // messaggio: Valore convertito o normalizzato prima del suo utilizzo.
            const messaggio = String(error?.message || error);
            if (!messaggio.toLowerCase().includes('already been rendered')) {
                console.error('Errore reCAPTCHA:', error);
            }
        }
    },

    // ottieniTokenRecaptcha: Legge il token del widget associato alla modale da inviare al backend.
    // Riceve: idModale (id della finestra modale).
    ottieniTokenRecaptcha(idModale) {
        if (this.usaRecaptchaLocale()) {
            // checkbox: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
            const checkbox = document.querySelector(`#${idModale} [data-recaptcha-locale="true"]`);
            return checkbox?.checked ? 'local-dev-recaptcha-ok' : '';
        }

        // widgetId: Valore della proprietà .recaptchaWidgets.idModale, conservato per le operazioni successive.
        const widgetId = this.recaptchaWidgets[idModale];

        if (typeof grecaptcha !== 'undefined' && typeof grecaptcha.getResponse === 'function' && widgetId !== undefined) {
            return grecaptcha.getResponse(widgetId);
        }

        return document.querySelector(`#${idModale} [name="g-recaptcha-response"]`)?.value || '';
    },

    // resettaRecaptcha: Ripristina il controllo della modale dopo il tentativo di invio.
    // Riceve: idModale (id della finestra modale).
    resettaRecaptcha(idModale) {
        if (this.usaRecaptchaLocale()) {
            // checkbox: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
            const checkbox = document.querySelector(`#${idModale} [data-recaptcha-locale="true"]`);
            if (checkbox) checkbox.checked = false;
            return;
        }

        // widgetId: Valore della proprietà .recaptchaWidgets.idModale, conservato per le operazioni successive.
        const widgetId = this.recaptchaWidgets[idModale];

        if (typeof grecaptcha !== 'undefined' && typeof grecaptcha.reset === 'function' && widgetId !== undefined) {
            try {
                grecaptcha.reset(widgetId);
            } catch (error) {
                // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
                console.error('Errore reset reCAPTCHA:', error);
            }
        }
    },

    // nascondiSplash: Termina la schermata di caricamento iniziale con i tempi previsti dall’interfaccia.
    nascondiSplash() {
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        setTimeout(() => {
            // loader: Elemento DOM loading-screen: Contenitore dell’interfaccia.
            const loader = document.getElementById('loading-screen');
            if (loader) {
                loader.style.opacity = '0';
                // Esegue l’azione alla scadenza del temporizzatore previsto.
                setTimeout(() => loader.style.display = 'none', 800);
            }
        }, 1200); 
    },

    // aggiornaUINavbar: Mostra le voci di navigazione compatibili con autenticazione e ruolo dell’utente.
    // Riceve: utente (dati dell’utente).
    aggiornaUINavbar(utente) {
        window.app.utenteCorrente = utente;
        window.app.mioRuolo = utente.ruolo;
        // containerSaluto: Elemento DOM container-saluto: Etichetta o indicatore dell’interfaccia.
        const containerSaluto = document.getElementById('container-saluto');
        // testoSaluto: Elemento DOM testo-saluto: Etichetta o indicatore dell’interfaccia.
        const testoSaluto = document.getElementById('testo-saluto');
        
        if (containerSaluto && testoSaluto) {
            containerSaluto.classList.remove('hidden');
            testoSaluto.innerText = `👋 Ciao, ${utente.nome}`;
        }
        
        if (testoSaluto) testoSaluto.textContent = `Ciao, ${utente.nome}`;

        // profileButton: Elemento DOM btn-profilo: Pulsante del controllo.
        const profileButton = document.getElementById('btn-profilo');
        if (profileButton) profileButton.textContent = 'Area personale';

        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: el (elemento DOM corrente).
        document.querySelectorAll('.nome-nav').forEach(el => el.remove());
    },

    // controllaSeLoggato: Chiede il profilo al backend e ricostruisce lo stato del frontend dalla sessione esistente.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async controllaSeLoggato() {
        try {
            // dati: Dati ricevuti dall’API o dall’evento di questo blocco.
            const dati = await this.apiRequest('/api/profilo');

            window.app.mioId = dati.utente.id;
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: c (iscrizione al corso).
            window.app.mieIscrizioniCorsi = dati.iscrizioni.map(c => c.id);
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: g (iscrizione alla gara).
            window.app.mieIscrizioniGare = dati.iscrizioni_gare.map(g => g.id);

            this.aggiornaUINavbar(dati.utente);

            document.getElementById('btn-profilo')?.classList.remove('hidden');
            document.getElementById('btn-logout')?.classList.remove('hidden');
            document.getElementById('btn-login-nav')?.classList.add('hidden');
            document.getElementById('btn-registrati-nav')?.classList.add('hidden');
            document.getElementById('btn-login-home')?.classList.add('hidden');
            document.getElementById('btn-chat')?.classList.remove('hidden');

            if (typeof this.connettiChat === 'function') this.connettiChat();

            // isAdmin: Indicatore booleano che controlla la condizione descritta dal nome.
            const isAdmin = dati.utente.ruolo === 'ADMIN';
            // isCoach: Indicatore booleano che controlla la condizione descritta dal nome.
            const isCoach = dati.utente.ruolo === 'COACH';
            document.getElementById('btn-admin')?.classList.toggle('hidden', !isAdmin);
            document.getElementById('btn-admin-profilo')?.classList.toggle('hidden', !isAdmin);
            document.getElementById('btn-coach')?.classList.toggle('hidden', !isCoach);
            document.getElementById('btn-coach-profilo')?.classList.toggle('hidden', !isCoach);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            if (error.status !== 401) console.error('Controllo sessione fallito:', error);
            document.getElementById('btn-login-nav')?.classList.remove('hidden');
            document.getElementById('btn-registrati-nav')?.classList.remove('hidden');
            document.getElementById('btn-login-home')?.classList.remove('hidden');
        } finally {
            if(typeof this.nascondiSplash === 'function') this.nascondiSplash();
        }
    },

    // eseguiLogin: Legge il form, invia credenziali e token reCAPTCHA e aggiorna la pagina dopo il login.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async eseguiLogin() {
        // emailScritta: Valore letto dal campo HTML da validare o inviare.
        const emailScritta = document.getElementById('input-email').value;
        // passwordScritta: Valore letto dal campo HTML da validare o inviare.
        const passwordScritta = document.getElementById('input-password').value;
        // recaptchaToken: Risposta del controllo reCAPTCHA da verificare sul backend.
        const recaptchaToken = this.ottieniTokenRecaptcha('modale-login');

        if (!emailScritta || !passwordScritta) return this.mostraNotifica("Inserisci email e password.", "warning");
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (!recaptchaToken) return this.mostraNotifica("Completa la verifica anti-robot.", "warning");

        try {
            // risultato: Esito della richiesta al backend utilizzato per aggiornare l’interfaccia.
            const risultato = await this.apiRequest('/api/login', {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
                method: 'POST',
                body: { email: emailScritta, password: passwordScritta, recaptchaToken }
            });

            window.app.mioId = risultato.utente.id;
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: c (iscrizione al corso).
            window.app.mieIscrizioniCorsi = risultato.iscrizioni ? risultato.iscrizioni.map(c => c.id) : [];
            // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
            // Riceve: g (iscrizione alla gara).
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

            // isAdmin: Indicatore booleano che controlla la condizione descritta dal nome.
            const isAdmin = risultato.utente.ruolo === 'ADMIN';
            // isCoach: Indicatore booleano che controlla la condizione descritta dal nome.
            const isCoach = risultato.utente.ruolo === 'COACH';
            document.getElementById('btn-admin')?.classList.toggle('hidden', !isAdmin);
            document.getElementById('btn-admin-profilo')?.classList.toggle('hidden', !isAdmin);
            document.getElementById('btn-coach')?.classList.toggle('hidden', !isCoach);
            document.getElementById('btn-coach-profilo')?.classList.toggle('hidden', !isCoach);

            this.resettaRecaptcha('modale-login');
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            setTimeout(() => { this.naviga('profilo'); }, 500);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            if(typeof this.mostraNotifica === 'function') this.mostraNotifica(this.apiErrorMessage(error), "error");
            this.resettaRecaptcha('modale-login');
        }
    },

    // registrati: Valida il form di registrazione e invia i dati dell’account al backend.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async registrati() {
        // nome: Valore letto dal campo HTML da validare o inviare.
        const nome = document.getElementById('reg-nome').value;
        // cognome: Valore letto dal campo HTML da validare o inviare.
        const cognome = document.getElementById('reg-cognome').value;
        // email: Valore letto dal campo HTML da validare o inviare.
        const email = document.getElementById('reg-email').value;
        // password: Valore letto dal campo HTML da validare o inviare.
        const password = document.getElementById('reg-password').value;
        // recaptchaToken: Risposta del controllo reCAPTCHA da verificare sul backend.
        const recaptchaToken = this.ottieniTokenRecaptcha('modale-registrazione');

        if (!nome || !cognome || !email || !password) return this.mostraNotifica("Compila tutti i campi.", "warning");
        // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
        if (!recaptchaToken) return this.mostraNotifica("Completa la verifica anti-robot.", "warning");

        try {
            // risultato: Esito della richiesta al backend utilizzato per aggiornare l’interfaccia.
            const risultato = await this.apiRequest('/api/registrati', {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
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
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            setTimeout(() => { this.apriModale('modale-login'); }, 1500);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            if(typeof this.mostraNotifica === 'function') this.mostraNotifica(this.apiErrorMessage(error), "error");
            this.resettaRecaptcha('modale-registrazione');
        }
    },

    // eseguiLogout: Chiude la sessione sul backend e ripristina lo stato del frontend.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async eseguiLogout() {
        try {
            // method: Metodo HTTP che identifica l’operazione richiesta al backend.
            await this.apiRequest('/api/logout', { method: 'POST' });
            window.location.reload(); 
        } catch (error) { 
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this.mostraNotifica?.(this.apiErrorMessage(error, 'Errore durante il logout.'), 'error');
        }
    }
});

if (typeof grecaptcha !== 'undefined' && typeof grecaptcha.render === 'function') {
    window.app.gestisciRecaptchaPronto?.();
}
