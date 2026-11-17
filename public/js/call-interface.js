// Frontend chiamate: presenta stato, durata, dispositivi, griglia e statistiche senza inviare nuovi flussi
// multimediali.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// Racchiude inizializzazione e stato in un ambito locale, senza esporre variabili aggiuntive.
(() => {
    'use strict';

    // element: Restituisce l’elemento DOM associato all’id oppure null.
    // Riceve: id (identificativo dell’elemento).
    const element = id => document.getElementById(id);
    // view: Stato privato della vista della chiamata, compresi intervallo e statistiche.
    let view = null;

    // text: Aggiorna il testo dell’elemento soltanto se è cambiato, evitando scritture DOM ripetute.
    // Riceve: id (identificativo dell’elemento); value (valore da elaborare).
    function text(id, value) {
        // node: Risultato di element. Restituisce l’elemento DOM associato all’id oppure null.
        const node = element(id);
        if (node && node.textContent !== value) node.textContent = value;
    }

    // connectionInfo: Legge la coppia ICE selezionata e restituisce percorso diretto o TURN e tempo di andata e
    // ritorno.
    // Riceve: report (statistiche o resoconto da interpretare).
    // Restituisce path e latency; null segnala dati non disponibili.
    function connectionInfo(report) {
        // entries: Elenco dei valori che questo blocco deve confrontare, mostrare o elaborare.
        const entries = [...report.values()];
        // transport: Trasporto WebRTC che identifica la coppia ICE effettivamente selezionata.
        // Restituisce il criterio per individuare il primo elemento corrispondente.
        // Riceve: item (elemento corrente).
        const transport = entries.find(item => item.type === 'transport' && item.selectedCandidatePairId);
        // pair: Coppia di candidati ICE usata dal collegamento da analizzare.
        const pair = (transport && report.get(transport.selectedCandidatePairId)) ||
            // Restituisce il criterio per individuare il primo elemento corrispondente.
            // Riceve: item (elemento corrente).
            entries.find(item => item.type === 'candidate-pair' && item.state === 'succeeded' &&
                (item.selected === true || item.nominated === true));
        if (!pair || pair.state !== 'succeeded') return { path: null, latency: null };

        // local: Valore recuperato dalla raccolta indicizzata mediante la chiave.
        const local = report.get(pair.localCandidateId);
        // remote: Valore recuperato dalla raccolta indicizzata mediante la chiave.
        const remote = report.get(pair.remoteCandidateId);
        // relay: Indica se almeno uno dei candidati selezionati usa un relay TURN.
        const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
        // known: Indica se sono disponibili i tipi di entrambi i candidati della coppia.
        const known = local?.candidateType && remote?.candidateType;
        return {
            path: relay ? 'turn' : known ? 'direct' : null,
            latency: Number.isFinite(pair.currentRoundTripTime) && pair.currentRoundTripTime >= 0
                ? Math.round(pair.currentRoundTripTime * 1000) : null
        };
    }

    // formatDuration: Formatta il tempo trascorso in minuti e secondi, aggiungendo le ore quando necessarie.
    // Riceve: startedAt (istante iniziale); now (istante di riferimento).
    function formatDuration(startedAt, now = Date.now()) {
        // seconds: Componente dei secondi della durata o dell’orario.
        const seconds = startedAt == null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
        // hours: Componente delle ore della durata o dell’orario.
        const hours = Math.floor(seconds / 3600);
        // minutes: Componente dei minuti della durata o dell’orario.
        const minutes = Math.floor(seconds / 60) % 60;
        // remainder: Parte residua dei secondi dopo la separazione dei minuti.
        const remainder = seconds % 60;
        return (hours ? String(hours).padStart(2, '0') + ':' : '') +
            String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
    }

    // setLayout: Imposta la vista a griglia o primo piano e aggiorna il pulsante di visualizzazione.
    // Riceve: layout (modalità di visualizzazione).
    function setLayout(layout) {
        // modal: Elemento DOM della finestra modale su cui opera il blocco.
        const modal = element('modale-videochiamata');
        if (modal) modal.dataset.layout = layout === 'grid' ? 'grid' : 'focus';
        // button: Pulsante DOM a cui applicare stato o comportamento.
        const button = element('vc-toggle-layout');
        if (!button) return;
        // grid: Risultato del calcolo o del controllo applicato ai valori del blocco.
        const grid = layout === 'grid';
        // label: Valore scelto tra i due rami in base alla condizione indicata.
        const label = grid ? 'Metti un partecipante in primo piano' : 'Mostra a griglia';
        button.setAttribute('aria-pressed', String(grid));
        button.setAttribute('aria-label', label);
        button.title = label;
        // caption: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const caption = button.querySelector('span');
        if (caption) caption.textContent = grid ? 'Primo piano' : 'Griglia';
    }

    // showDevices: Mostra o chiude il pannello dei dispositivi e gestisce il focus collegato.
    // Riceve: visible (visibilità desiderata); restoreFocus (se ripristinare il focus).
    function showDevices(visible, restoreFocus = true) {
        // panel: Elemento DOM del pannello da mostrare, chiudere o aggiornare.
        const panel = element('vc-device-panel');
        // button: Pulsante DOM a cui applicare stato o comportamento.
        const button = element('vc-toggle-devices');
        if (!panel || !button) return;
        panel.hidden = !visible;
        button.setAttribute('aria-expanded', String(visible));
        if (visible) {
            refreshDevices();
            element('vc-close-devices')?.focus();
        } else if (restoreFocus) button.focus();
    }

    // renderConnection: Traduce lo stato ICE e le statistiche in etichette, durata e indicatori della chiamata.
    // Riceve: state (stato da rappresentare).
    function renderConnection(state) {
        // ice: Valore della proprietà state.connection.iceConnectionState, conservato per le operazioni successive.
        const ice = state.connection?.iceConnectionState;
        // connected: Indica se il collegamento ICE è nello stato connesso previsto.
        const connected = ice === 'connected' || ice === 'completed';
        // reconnecting: Indica che la connessione è temporaneamente interrotta.
        const reconnecting = ice === 'disconnected';
        // failed: Indica che il collegamento è fallito o è stato chiuso.
        const failed = ice === 'failed' || ice === 'closed';
        // status: Stato normalizzato da rappresentare nell’interfaccia.
        const status = connected ? 'connected' : reconnecting ? 'reconnecting' : failed ? 'failed' : 'connecting';
        // modal: Elemento DOM della finestra modale su cui opera il blocco.
        const modal = element('modale-videochiamata');
        if (modal) modal.dataset.state = status;
        text('vc-connection-status', connected ? 'Connesso' : reconnecting ? 'Riconnessione…' :
            failed ? 'Collegamento interrotto' : 'In collegamento');
        text('vc-call-title', state.remoteName ? 'Chiamata con ' + state.remoteName : 'La tua chiamata');
        text('vc-call-duration', formatDuration(state.startedAt));
        // mic: Risultato di element. Restituisce l’elemento DOM associato all’id oppure null.
        const mic = element('vc-local-mic-status');
        if (mic) mic.hidden = state.micOn;

        if (!connected) {
            if (view) view.info = null;
            text('vc-network-path', reconnecting ? 'Ripristino connessione' : failed ? 'Connessione interrotta' : 'Connessione in corso');
            text('vc-network-latency', reconnecting ? 'Attendi il ripristino del collegamento' :
                failed ? 'Chiudi e riprova la chiamata' : 'In attesa del collegamento');
            return;
        }
        // info: Informazioni disponibili per il file, la connessione o la vista nel blocco corrente.
        const info = view?.info;
        text('vc-network-path', info?.path === 'turn' ? 'Relay TURN' :
            info?.path === 'direct' ? 'Collegamento diretto' : 'Collegamento attivo');
        text('vc-network-latency', info?.latency != null ? 'Latenza ' + info.latency + ' ms' : 'Rilevamento percorso…');
    }

    // refreshConnectionStats: Legge getStats senza sovrapporre richieste e ignora risultati di chiamate ormai chiuse.
    // Riceve: state (stato da rappresentare).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async function refreshConnectionStats(state) {
        // current: Riferimento allo stato attuale da confrontare dopo un’operazione asincrona.
        const current = view;
        // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
        const connection = state.connection;
        if (!current || current.statsBusy || !connection?.getStats ||
            !['connected', 'completed'].includes(connection.iceConnectionState)) return;
        current.statsBusy = true;
        current.lastStatsAt = Date.now();
        try {
            // report: Rapporto getStats con trasporti, coppie ICE e dati del collegamento.
            const report = await connection.getStats();
            if (view !== current || current.getState().connection !== connection) return;
            current.info = connectionInfo(report);
            renderConnection(current.getState());
        } catch {
            // Le statistiche non sono disponibili in tutti i browser.
        } finally {
            current.statsBusy = false;
        }
    }

    // sync: Sincronizza vista e disponibilità dei dispositivi e avvia le statistiche quando è trascorso l’intervallo
    // previsto.
    // Riceve: state (stato da rappresentare).
    function sync(state) {
        renderConnection(state);
        // microphone: Traccia o controllo del microfono locale nel blocco corrente.
        const microphone = element('vc-microphone-device');
        if (microphone) microphone.disabled = !state.connection?.remoteDescription ||
            // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
            // Riceve: option (opzione del menu).
            Boolean(window.app.microphoneRequest) || ![...microphone.options].some(option => option.value);
        // cameraHint: Elemento che spiega come rendere disponibili le videocamere.
        const cameraHint = element('vc-camera-device-hint');
        if (cameraHint) cameraHint.hidden = !element('vc-camera-device')?.hidden;
        if (view && Date.now() - view.lastStatsAt >= 4000) refreshConnectionStats(state);
    }

    // fillDevices: Ricostruisce le opzioni del selettore e conserva il dispositivo scelto quando ancora disponibile.
    // Riceve: id (identificativo dell’elemento); devices (periferiche disponibili); selectedId (id della periferica
    // selezionata); fallback (valore o messaggio di ripiego).
    function fillDevices(id, devices, selectedId, fallback) {
        // select: Elemento select da popolare o leggere.
        const select = element(id);
        if (!select) return;
        // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
        // Riceve: device (periferica corrente); index (posizione nell’elenco).
        select.replaceChildren(...devices.map((device, index) =>
            new Option(device.label || fallback + ' ' + (index + 1), device.deviceId)));
        if (!devices.length) select.add(new Option('Nessun dispositivo disponibile', ''));
        // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
        // Riceve: device (periferica corrente).
        if (devices.some(device => device.deviceId === selectedId)) select.value = selectedId;
        select.disabled = devices.length === 0;
    }

    // refreshDevices: Aggiorna gli elenchi di microfoni, webcam e uscite audio senza richiedere nuove acquisizioni.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async function refreshDevices() {
        // current: Riferimento allo stato attuale da confrontare dopo un’operazione asincrona.
        const current = view;
        if (!current || !navigator.mediaDevices?.enumerateDevices) return;
        try {
            // devices: Periferiche restituite dall’enumerazione del browser.
            const devices = await navigator.mediaDevices.enumerateDevices();
            if (view !== current) return;
            // state: Risultato della chiamata current.getState, riutilizzato nelle istruzioni successive.
            const state = current.getState();
            // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
            // Riceve: device (periferica corrente).
            fillDevices('vc-microphone-device', devices.filter(device =>
                device.kind === 'audioinput' && device.deviceId),
            state.microphoneId, 'Microfono');
            // output: Uscita o risultato raccolto nel contesto corrente.
            const output = element('audio-remoto');
            // speaker: Risultato di element. Restituisce l’elemento DOM associato all’id oppure null.
            const speaker = element('vc-speaker-device');
            // supportsOutput: Indica se il browser permette di scegliere l’uscita tramite setSinkId.
            const supportsOutput = typeof output?.setSinkId === 'function';
            if (supportsOutput) {
                // outputs: Dispositivi di uscita audio disponibili al browser.
                // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
                // Riceve: device (periferica corrente).
                const outputs = devices.filter(device => device.kind === 'audiooutput' && device.deviceId);
                fillDevices('vc-speaker-device', outputs, output.sinkId || 'default', 'Uscita audio');
                text('vc-speaker-device-hint', outputs.length
                    ? 'Scegli dove ascoltare l’altra persona.'
                    : 'L’uscita audio viene gestita dal browser o dal dispositivo.');
            } else if (speaker) {
                speaker.disabled = true;
                text('vc-speaker-device-hint', 'Questo browser gestisce l’uscita audio dalle impostazioni del dispositivo.');
            }
            await window.app.aggiornaElencoVideocamere?.();
            if (view === current) sync(current.getState());
        } catch {
            if (view === current) text('vc-device-feedback', 'Impossibile leggere le periferiche. Controlla i permessi del browser.');
        }
    }

    // changeOutput: Chiede al browser di usare l’uscita audio selezionata e gestisce dispositivi o permessi mancanti.
    // Riceve: deviceId (id della periferica scelta).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async function changeOutput(deviceId) {
        // output: Uscita o risultato raccolto nel contesto corrente.
        const output = element('audio-remoto');
        // current: Riferimento allo stato attuale da confrontare dopo un’operazione asincrona.
        const current = view;
        if (!current || !output?.setSinkId) return;
        try {
            await output.setSinkId(deviceId);
            if (view === current) text('vc-device-feedback', 'Uscita audio aggiornata.');
        } catch {
            if (view === current) {
                text('vc-device-feedback', 'Uscita audio non disponibile. Controlla i permessi del browser.');
                refreshDevices();
            }
        }
    }

    // fullscreenState: Allinea titolo e stato del pulsante alla modalità schermo intero effettiva.
    function fullscreenState() {
        // button: Pulsante DOM a cui applicare stato o comportamento.
        const button = element('vc-fullscreen');
        if (!button) return;
        // active: Risultato del calcolo o del controllo applicato ai valori del blocco.
        const active = document.fullscreenElement === element('modale-videochiamata');
        // label: Valore scelto tra i due rami in base alla condizione indicata.
        const label = active ? 'Esci da schermo intero' : 'Schermo intero';
        button.setAttribute('aria-pressed', String(active));
        button.setAttribute('aria-label', label);
        button.title = label;
    }

    // open: Apre il monitoraggio della vista della chiamata e ne inizializza layout, dispositivi e focus.
    // Riceve: getState (funzione che legge lo stato attuale).
    function open(getState) {
        close(false);
        view = { getState, previousFocus: document.activeElement, lastStatsAt: 0, statsBusy: false, info: null };
        setLayout('focus');
        showDevices(false, false);
        text('vc-device-feedback', 'Le periferiche disponibili vengono aggiornate durante la chiamata.');
        // current: Riferimento allo stato attuale da confrontare dopo un’operazione asincrona.
        const current = view;
        // Esegue l’azione alla scadenza del temporizzatore previsto.
        current.interval = window.setInterval(() => {
            if (view === current) sync(current.getState());
        }, 1000);
        sync(getState());
        refreshDevices();
        // fullscreen: Risultato di element. Restituisce l’elemento DOM associato all’id oppure null.
        const fullscreen = element('vc-fullscreen');
        if (fullscreen) fullscreen.hidden = !document.fullscreenEnabled ||
            typeof element('modale-videochiamata')?.requestFullscreen !== 'function';
        element('vc-toggle-layout')?.focus();
    }

    // close: Ferma il monitoraggio della vista, chiude le preferenze e ripristina il focus quando richiesto.
    // Riceve: restoreFocus (se ripristinare il focus).
    function close(restoreFocus = true) {
        // previous: Riferimento precedente da ripristinare o verificare prima della sostituzione.
        const previous = view;
        view = null;
        if (previous) window.clearInterval(previous.interval);
        showDevices(false, false);
        if (document.fullscreenElement && document.fullscreenElement === element('modale-videochiamata')) {
            // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
            document.exitFullscreen?.().catch(() => {});
        }
        if (previous && restoreFocus) {
            // target: Valore scelto tra i due rami in base alla condizione indicata.
            const target = previous.previousFocus?.isConnected && previous.previousFocus.getClientRects().length
                ? previous.previousFocus : element('btn-avvia-chiamata');
            target?.focus();
        }
    }

    // initialise: Registra i gestori della vista della chiamata, compresi tastiera e pulsanti di visualizzazione.
    function initialise() {
        // modal: Elemento DOM della finestra modale su cui opera il blocco.
        const modal = element('modale-videochiamata');

        // I video sono superfici di visualizzazione: i comandi della chiamata restano sui pulsanti.
        modal?.querySelectorAll('video').forEach(video => {
            video.controls = false;
            video.addEventListener('pause', () => {
                // Riprende solo flussi vivi di una chiamata visibile, senza riaprire tracce terminate.
                if (!view || document.hidden || modal.getAttribute('aria-hidden') === 'true' ||
                    !video.srcObject?.getVideoTracks().some(track => track.readyState === 'live')) return;
                video.play().catch(() => {});
            });
        });
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        element('vc-toggle-layout')?.addEventListener('click', () =>
            setLayout(modal.dataset.layout === 'grid' ? 'focus' : 'grid'));
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        element('vc-toggle-devices')?.addEventListener('click', () =>
            showDevices(Boolean(element('vc-device-panel')?.hidden)));
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        element('vc-close-devices')?.addEventListener('click', () => showDevices(false));
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: event (evento del browser).
        element('vc-microphone-device')?.addEventListener('change', event =>
            window.app.cambiaMicrofonoChiamata?.(event.target.value));
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: event (evento del browser).
        element('vc-speaker-device')?.addEventListener('change', event => changeOutput(event.target.value));
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
        element('vc-fullscreen')?.addEventListener('click', async () => {
            try {
                if (document.fullscreenElement === modal) await document.exitFullscreen();
                else await modal.requestFullscreen();
            } catch {
                window.app.mostraNotifica?.('Schermo intero non disponibile in questo browser.', 'info');
            }
            fullscreenState();
        });
        document.addEventListener('fullscreenchange', fullscreenState);
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: button (pulsante da configurare).
        document.querySelectorAll('[data-pin-card]').forEach(button => {
            // Esegue l’azione del controllo quando viene premuto.
            // Riceve: event (evento del browser).
            button.addEventListener('click', event => {
                event.stopPropagation();
                window.app.focusCard(button.dataset.pinCard);
            });
        });
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: event (evento del browser).
        modal?.addEventListener('click', event => {
            // panel: Elemento DOM del pannello da mostrare, chiudere o aggiornare.
            const panel = element('vc-device-panel');
            if (panel && !panel.hidden && !panel.contains(event.target) &&
                !element('vc-toggle-devices')?.contains(event.target)) showDevices(false, false);
        });
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: event (evento del browser).
        modal?.addEventListener('keydown', event => {
            if (!view) return;
            if (event.key === 'Escape' && !element('vc-device-panel')?.hidden) {
                event.preventDefault();
                showDevices(false);
            }
            if (event.key !== 'Tab') return;
            // focusable: Controlli visibili e abilitati che possono ricevere il focus da tastiera.
            const focusable = [...modal.querySelectorAll('button:not([disabled]), select:not([disabled])')]
                // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
                // Riceve: node (nodo DOM da verificare).
                .filter(node => node.getClientRects().length > 0);
            // first: Primo elemento della raccolta o dell’intervallo considerato.
            const first = focusable[0];
            // last: Ultimo elemento della raccolta o dell’intervallo considerato.
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        });
    }

    window.callView = { open, close, sync, setLayout, refreshDevices, connectionInfo, formatDuration };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialise, { once: true });
    else initialise();
})();
