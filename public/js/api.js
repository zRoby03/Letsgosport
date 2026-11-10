window.app = window.app || {};

Object.assign(window.app, {
    backendDisponibile: null,
    verificaBackendInCorso: null,

    erroreBackendNonRaggiungibile(cause) {
        const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
        const message = isLocal
            ? 'Backend locale non raggiungibile. Avvia il progetto con npm start e apri http://localhost:3000.'
            : 'Il servizio non è raggiungibile. Riprova tra qualche secondo.';
        const error = new Error(message, cause ? { cause } : undefined);
        error.code = 'BACKEND_UNREACHABLE';
        return error;
    },

    async apiRequest(url, options = {}) {
        if (window.location.protocol === 'file:') {
            throw this.erroreBackendNonRaggiungibile();
        }

        const {
            timeout = 20000,
            headers = {},
            body,
            ...fetchOptions
        } = options;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const requestHeaders = new Headers(headers);
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
            const response = await fetch(url, {
                credentials: 'same-origin',
                ...fetchOptions,
                headers: requestHeaders,
                body: requestBody,
                signal: controller.signal
            });

            const contentType = response.headers.get('content-type') || '';
            let data = null;
            if (response.status !== 204) {
                data = contentType.includes('application/json')
                    ? await response.json()
                    : await response.text();
            }

            if (!response.ok) {
                const error = new Error(data?.errore || `Richiesta non riuscita (${response.status})`);
                error.status = response.status;
                error.data = data;
                throw error;
            }

            return data;
        } catch (error) {
            if (error.name === 'AbortError') {
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

    mostraStatoBackend(message = '', checking = false) {
        const banner = document.getElementById('stato-backend');
        const text = document.getElementById('stato-backend-testo');
        const retry = document.getElementById('stato-backend-riprova');
        if (banner) banner.hidden = !message;
        if (text) text.textContent = message;
        if (retry) retry.disabled = checking;
    },

    verificaBackend() {
        if (this.verificaBackendInCorso) return this.verificaBackendInCorso;
        this.verificaBackendInCorso = this.verificaBackendConRetry().finally(() => {
            this.verificaBackendInCorso = null;
        });
        return this.verificaBackendInCorso;
    },

    async verificaBackendConRetry() {
        for (const delay of [0, 1200, 3600]) {
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            try {
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

    apiErrorMessage(error, fallback = 'Errore di connessione.') {
        if (error?.code === 'BACKEND_UNREACHABLE') return error.message;
        return error?.data?.errore || error?.message || fallback;
    }
});
