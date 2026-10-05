window.app = window.app || {};

Object.assign(window.app, {
    backendDisponibile: null,

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
        if (this.backendDisponibile === false && url !== '/api/health') {
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

    async verificaBackend() {
        try {
            await this.apiRequest('/api/health', { timeout: 15000 });
            this.backendDisponibile = true;
            return true;
        } catch (error) {
            this.backendDisponibile = false;
            const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname)
                || window.location.protocol === 'file:';
            const message = isLocal
                ? 'Backend locale non attivo: usa npm start e apri http://localhost:3000.'
                : this.apiErrorMessage(error, 'Servizio momentaneamente non disponibile.');
            this.mostraNotifica?.(message, 'error');
            console.error('Verifica backend fallita:', message);
            return false;
        }
    },

    apiErrorMessage(error, fallback = 'Errore di connessione.') {
        if (error?.code === 'BACKEND_UNREACHABLE') return error.message;
        return error?.data?.errore || error?.message || fallback;
    }
});
