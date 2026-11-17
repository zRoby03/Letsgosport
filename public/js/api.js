// Frontend: invia richieste HTTP al backend, interpreta JSON, gestisce timeout e verifica la disponibilità del
// servizio.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
window.app = window.app || {};

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {
    // backendDisponibile: Stato dell’ultima verifica della disponibilità del backend.
    backendDisponibile: null,
    // verificaBackendInCorso: Promise condivisa per evitare controlli di salute sovrapposti.
    verificaBackendInCorso: null,

    // erroreBackendNonRaggiungibile: Costruisce l’errore usato quando il server non è raggiungibile o la richiesta
    // scade.
    // Riceve: cause (causa originale dell’errore).
    erroreBackendNonRaggiungibile(cause) {
        // isLocal: Esito booleano del controllo di presenza o corrispondenza.
        const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
        // message: Messaggio di stato o contenuto da rappresentare.
        const message = isLocal
            ? 'Backend locale non raggiungibile. Avvia il progetto con npm start e apri http://localhost:3000.'
            : 'Il servizio non è raggiungibile. Riprova tra qualche secondo.';
        // error: Istanza di Error usata dalle operazioni di questo blocco.
        const error = new Error(message, cause ? { cause } : undefined);
        error.code = 'BACKEND_UNREACHABLE';
        return error;
    },

    // apiRequest: Esegue fetch con timeout, interpreta la risposta e propaga un errore utilizzabile dall’interfaccia.
    // Riceve: url (indirizzo della risorsa o del servizio); options (opzioni che controllano l’operazione).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    // Restituisce i dati della risposta, oppure solleva un errore per HTTP non riuscito, timeout o rete.
    async apiRequest(url, options = {}) {
        if (window.location.protocol === 'file:') {
            throw this.erroreBackendNonRaggiungibile();
        }

        // timeout: Identificativo dell’attesa massima prima di interrompere l’operazione.
        // headers: Riferimento al valore options utilizzato da questo blocco.
        // body: Corpo della richiesta o della risposta trattato in questo blocco.
        // fetchOptions: Opzioni fetch rimaste dopo la separazione di timeout, corpo e intestazioni.
        const {
            // timeout: Tempo massimo dell’operazione espresso in millisecondi.
            timeout = 20000,
            // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
            headers = {},
            body,
            ...fetchOptions
        } = options;
        // controller: AbortController che consente di interrompere la richiesta HTTP.
        const controller = new AbortController();
        // timeoutId: Identificativo del timer che interrompe la richiesta oltre la durata prevista.
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        // requestHeaders: Intestazioni HTTP preparate per la richiesta fetch.
        const requestHeaders = new Headers(headers);
        // requestBody: Corpo HTTP da inviare, eventualmente serializzato come JSON.
        let requestBody = body;

        if (
            body !== undefined &&
            body !== null &&
            !(body instanceof FormData) &&
            typeof body !== 'string' &&
            !(body instanceof Blob)
        ) {
            requestHeaders.set('Content-Type', 'application/json');
            requestBody = JSON.stringify(body);
        }

        try {
            // response: Risposta ricevuta dal backend o dal servizio esterno.
            const response = await fetch(url, {
                // credentials: Controlla l’uso delle credenziali HTTP, inclusi i cookie, per questa configurazione.
                credentials: 'same-origin',
                ...fetchOptions,
                // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
                headers: requestHeaders,
                body: requestBody,
                // signal: Collega il segnale con cui annullare l’operazione asincrona.
                signal: controller.signal
            });

            // contentType: Tipo di contenuto dichiarato dalla risposta HTTP.
            const contentType = response.headers.get('content-type') || '';
            // data: Contenuto della risposta HTTP, interpretato come JSON o testo secondo il tipo dichiarato.
            let data = null;
            if (response.status !== 204) {
                data = contentType.includes('application/json')
                    ? await response.json()
                    : await response.text();
            }

            if (!response.ok) {
                // error: Istanza di Error usata dalle operazioni di questo blocco.
                const error = new Error(data?.errore || `Richiesta non riuscita (${response.status})`);
                error.status = response.status;
                error.data = data;
                throw error;
            }

            return data;
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            if (error.name === 'AbortError') {
                // timeoutError: Errore locale che rappresenta il superamento del tempo massimo.
                const timeoutError = new Error('La richiesta ha impiegato troppo tempo.');
                timeoutError.status = 408;
                throw timeoutError;
            }
            if (error instanceof TypeError) {
                throw this.erroreBackendNonRaggiungibile(error);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    },

    // mostraStatoBackend: Aggiorna il messaggio che informa l’utente sulla disponibilità del backend.
    // Riceve: message (testo del messaggio); checking (se la verifica è in corso).
    mostraStatoBackend(message = '', checking = false) {
        // banner: Elemento DOM stato-backend: Contenitore dell’interfaccia.
        const banner = document.getElementById('stato-backend');
        // text: Elemento DOM stato-backend-testo: Etichetta o indicatore dell’interfaccia.
        const text = document.getElementById('stato-backend-testo');
        // retry: Elemento DOM stato-backend-riprova: Pulsante del controllo.
        const retry = document.getElementById('stato-backend-riprova');
        if (banner) banner.hidden = !message;
        if (text) text.textContent = message;
        if (retry) retry.disabled = checking;
    },

    // verificaBackend: Interroga il controllo di salute del server e condivide la verifica già in corso.
    verificaBackend() {
        if (this.verificaBackendInCorso) return this.verificaBackendInCorso;
        // Esegue la pulizia finale sia in caso di successo sia in caso di errore.
        this.verificaBackendInCorso = this.verificaBackendConRetry().finally(() => {
            this.verificaBackendInCorso = null;
        });
        return this.verificaBackendInCorso;
    },

    // verificaBackendConRetry: Ripete la verifica del backend con le attese previste dal codice.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async verificaBackendConRetry() {
        // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
        // delay: Riferimento o risultato da valorizzare durante l’operazione.
        for (const delay of [0, 1200, 3600]) {
            // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
            // Riceve: resolve (completa la Promise con successo).
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            try {
                // timeout: Tempo massimo dell’operazione espresso in millisecondi.
                await this.apiRequest('/api/health', { timeout: 12000 });
                this.backendDisponibile = true;
                this.mostraStatoBackend();
                return true;
            } catch {
                this.mostraStatoBackend('Connessione al servizio in corso…', true);
            }
        }

        this.backendDisponibile = false;
        this.mostraStatoBackend(this.erroreBackendNonRaggiungibile().message);
        return false;
    },

    // apiErrorMessage: Ricava un messaggio leggibile dall’errore oppure utilizza il testo predefinito.
    // Riceve: error (errore intercettato); fallback (valore o messaggio di ripiego).
    apiErrorMessage(error, fallback = 'Errore di connessione.') {
        if (error?.code === 'BACKEND_UNREACHABLE') return error.message;
        return error?.data?.errore || error?.message || fallback;
    }
});
