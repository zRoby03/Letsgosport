// Frontend chat: crea i player dei vocali e registra audio con MediaRecorder prima dell’upload.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
window.app = window.app || {};

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {

    // generaPlayerAudio: Costruisce il player DOM del messaggio vocale e collega riproduzione e barra di avanzamento.
    // Riceve: messaggio (dati o testo del messaggio).
    generaPlayerAudio(messaggio) {
        messaggio.contenuto = ''; 
        // uiId: Identificativo del messaggio usato per collegare player e controlli nel DOM.
        const uiId = messaggio.id || 'vocale_' + Math.random().toString(36).substr(2, 9);
        // audioSrc: Risultato di allegatoSrc. Costruisce l’indirizzo dell’allegato usando l’endpoint protetto associato al
        // messaggio.
        const audioSrc = this.allegatoSrc(messaggio);

        // player: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const player = this.creaElemento('div', { className: 'audio-player' });
        // playButton: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const playButton = this.creaElemento('button', {
            className: 'audio-player-toggle',
            attrs: {
                id: `btn-play-${uiId}`,
                type: 'button',
                'aria-label': 'Riproduci o metti in pausa il messaggio vocale'
            }
        });
        // playImage: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const playImage = this.creaElemento('img', {
            className: 'audio-player-toggle-icon',
            attrs: {
                id: `img-play-${uiId}`,
                src: 'uploads/buttons/tasto_audio_start.svg',
                alt: ''
            }
        });
        playButton.appendChild(playImage);
        // Esegue l’azione del controllo quando viene premuto. Alterna riproduzione e pausa del vocale, fermando gli altri
        // player della chat.
        playButton.addEventListener('click', () => this.playPausaVocale(uiId));

        // timeline: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const timeline = this.creaElemento('div', { className: 'audio-player-timeline' });
        // progress: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const progress = this.creaElemento('input', {
            className: 'audio-player-progress',
            attrs: {
                id: `progress-${uiId}`,
                type: 'range',
                value: '0',
                max: '100',
                'aria-label': 'Posizione messaggio vocale'
            }
        });
        // Aggiorna filtro o stato mentre l’utente modifica il campo. Sposta la riproduzione del vocale alla percentuale
        // scelta nella barra.
        progress.addEventListener('input', () => this.scorriVocale(uiId, progress.value));

        // times: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const times = this.creaElemento('div', { className: 'audio-player-times' });
        // currentTime: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const currentTime = this.creaElemento('span', {
            text: '0:00',
            attrs: { id: `time-current-${uiId}` }
        });
        // totalTime: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const totalTime = this.creaElemento('span', {
            text: '--:--',
            attrs: { id: `time-total-${uiId}` }
        });
        times.append(currentTime, totalTime);
        timeline.append(progress, times);

        // audioIcon: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const audioIcon = this.creaElemento('img', {
            className: 'audio-player-icon',
            attrs: { src: 'uploads/buttons/tasto_audio.svg', alt: '' }
        });
        // audio: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const audio = this.creaElemento('audio', {
            attrs: {
                id: `audio-${uiId}`,
                src: audioSrc,
                preload: 'metadata'
            }
        });
        // Gestisce l’errore della risorsa o dell’operazione collegata.
        audio.addEventListener('error', () => {
            totalTime.textContent = 'Errore ⚠️';
            totalTime.classList.add('is-error');
        });
        // Aggiorna tempo e avanzamento mentre la risorsa multimediale viene riprodotta. Aggiorna tempo corrente e barra di
        // avanzamento durante l’ascolto.
        audio.addEventListener('timeupdate', () => this.aggiornaTempoVocale(uiId));
        // Aggiorna la durata o le informazioni disponibili dopo la lettura dei metadati. Mostra la durata disponibile dopo
        // il caricamento dei metadati audio.
        audio.addEventListener('loadedmetadata', () => this.impostaDurataVocale(uiId));
        // Gestisce la fine della riproduzione o della traccia e ripristina i controlli. Riporta il player allo stato
        // iniziale al termine della riproduzione.
        audio.addEventListener('ended', () => this.resettaVocale(uiId));

        player.append(playButton, timeline, audioIcon, audio);
        return player;
    },

    // playPausaVocale: Alterna riproduzione e pausa del vocale, fermando gli altri player della chat.
    // Riceve: id (identificativo dell’elemento).
    playPausaVocale(id) {
        // audio: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const audio = document.getElementById(`audio-${id}`);
        // imgPlay: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const imgPlay = document.getElementById(`img-play-${id}`);
        if (!audio || !imgPlay) return;
        
        if (!audio.paused) {
            audio.pause(); 
            imgPlay.src = 'uploads/buttons/tasto_audio_start.svg';
        } else {
            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: a (primo elemento).
            document.querySelectorAll('audio').forEach(a => {
                if(a.id !== `audio-${id}` && a.id.startsWith('audio-')) {
                    a.pause();
                    // otherId: Risultato della chiamata a.id.replace, riutilizzato nelle istruzioni successive.
                    const otherId = a.id.replace('audio-', '');
                    // otherImg: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
                    const otherImg = document.getElementById(`img-play-${otherId}`);
                    if(otherImg) otherImg.src = 'uploads/buttons/tasto_audio_start.svg';
                }
            });
            
            // Elabora il risultato quando la Promise precedente si completa con successo.
            // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
            // Riceve: e (evento del browser).
            audio.play().then(() => {
                imgPlay.src = 'uploads/buttons/tasto_audio_pausa.svg';
            }).catch(e => {
                console.error("Errore riproduzione:", e);
                imgPlay.src = 'uploads/buttons/tasto_audio_start.svg';
            });
        }
    },

    // aggiornaTempoVocale: Aggiorna tempo corrente e barra di avanzamento durante l’ascolto.
    // Riceve: id (identificativo dell’elemento).
    aggiornaTempoVocale(id) {
        // audio: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const audio = document.getElementById(`audio-${id}`);
        // progress: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const progress = document.getElementById(`progress-${id}`);
        // currentTimeEl: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const currentTimeEl = document.getElementById(`time-current-${id}`);
        if (!audio || !progress || !currentTimeEl) return;
        
        if (audio.duration && audio.duration !== Infinity) {
            progress.value = (audio.currentTime / audio.duration) * 100;
        }
        currentTimeEl.innerText = this.formattaTempoVocale(audio.currentTime);
    },

    // impostaDurataVocale: Mostra la durata disponibile dopo il caricamento dei metadati audio.
    // Riceve: id (identificativo dell’elemento).
    impostaDurataVocale(id) {
        // audio: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const audio = document.getElementById(`audio-${id}`);
        // totalTimeEl: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const totalTimeEl = document.getElementById(`time-total-${id}`);
        if(audio && totalTimeEl && audio.duration && audio.duration !== Infinity) {
            totalTimeEl.innerText = this.formattaTempoVocale(audio.duration);
        }
    },

    // resettaVocale: Riporta il player allo stato iniziale al termine della riproduzione.
    // Riceve: id (identificativo dell’elemento).
    resettaVocale(id) {
        // imgPlay: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const imgPlay = document.getElementById(`img-play-${id}`);
        // progress: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const progress = document.getElementById(`progress-${id}`);
        // currentTimeEl: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const currentTimeEl = document.getElementById(`time-current-${id}`);
        if(imgPlay) imgPlay.src = 'uploads/buttons/tasto_audio_start.svg';
        if(progress) progress.value = 0;
        if(currentTimeEl) currentTimeEl.innerText = '0:00';
    },

    // scorriVocale: Sposta la riproduzione del vocale alla percentuale scelta nella barra.
    // Riceve: id (identificativo dell’elemento); percent (posizione percentuale della riproduzione).
    scorriVocale(id, percent) {
        // audio: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const audio = document.getElementById(`audio-${id}`);
        if(audio && audio.duration && audio.duration !== Infinity) {
            audio.currentTime = (percent / 100) * audio.duration;
        }
    },

    // formattaTempoVocale: Converte i secondi in una durata leggibile in minuti e secondi.
    // Riceve: seconds (durata in secondi).
    formattaTempoVocale(seconds) {
        if (isNaN(seconds) || seconds === Infinity) return "0:00";
        // min: Parte dei minuti nella durata del vocale.
        const min = Math.floor(seconds / 60);
        // sec: Secondi residui nella durata del vocale.
        const sec = Math.floor(seconds % 60);
        return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    },

    // mediaRecorder: Registratore del browser, disponibile soltanto durante il flusso previsto.
    mediaRecorder: null,
    // audioChunks: Frammenti raccolti da MediaRecorder prima della creazione del Blob.
    audioChunks: [],
    // staRegistrando: Stato booleano che evita l’avvio di registrazioni vocali sovrapposte.
    staRegistrando: false,
    // Ogni pressione conserva la propria stanza, le tracce e i frammenti fino alla conclusione.
    registrazioneVocale: null,
    timerRegistrazioneVocale: null,

    aggiornaFeedbackVocale(stato = 'idle') {
        const sessione = this.registrazioneVocale;
        const pannello = document.getElementById('stato-registrazione-vocale');
        const pulsante = document.getElementById('btn-registra-vocale');
        const annulla = document.getElementById('btn-annulla-vocale');
        const etichetta = document.getElementById('etichetta-registrazione-vocale');
        const suggerimento = document.getElementById('suggerimento-registrazione-vocale');
        const tempo = document.getElementById('tempo-registrazione-vocale');
        const testi = {
            pending: ['Attivazione microfono…', 'Continua a tenere premuto.'],
            recording: ['Registrazione in corso', 'Rilascia per inviare'],
            sending: ['Invio del vocale…', 'Attendi il completamento.']
        };
        if (pannello) {
            pannello.hidden = stato === 'idle';
            pannello.dataset.state = stato;
        }
        document.querySelector('#pagina-chat .chat-composer')?.classList.toggle('has-voice-status', stato !== 'idle');
        if (etichetta) etichetta.textContent = testi[stato]?.[0] || '';
        if (suggerimento) suggerimento.textContent = testi[stato]?.[1] || '';
        if (annulla) annulla.hidden = !['pending', 'recording'].includes(stato);
        if (tempo) {
            tempo.hidden = !sessione?.startedAt;
            tempo.textContent = this.formattaTempoVocale(sessione?.startedAt ? (Date.now() - sessione.startedAt) / 1000 : 0);
        }
        pulsante?.classList.toggle('is-recording', stato === 'recording');
        pulsante?.setAttribute('aria-pressed', String(stato === 'recording'));
        pulsante?.setAttribute('aria-busy', String(stato === 'pending' || stato === 'sending'));
        pulsante?.setAttribute('aria-label', stato === 'recording' ? 'Registrazione in corso: rilascia per inviare' : 'Tieni premuto per registrare un vocale');
        this.aggiornaComposerChat?.();
    },

    pulisciRegistrazioneVocale(sessione) {
        sessione.stream?.getTracks().forEach(track => track.stop());
        window.clearInterval(sessione.timer);
        if (this.registrazioneVocale !== sessione) return;
        this.timerRegistrazioneVocale = null;
        this.registrazioneVocale = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.staRegistrando = false;
        this.aggiornaFeedbackVocale();
    },

    // iniziaRegistrazioneVocale: Acquisisce il microfono e prepara MediaRecorder per raccogliere i frammenti audio.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async iniziaRegistrazioneVocale() {
        if (this.registrazioneVocale || !window.stanzaAttuale) return;
        if (!socket.connected) {
            this.mostraNotifica?.("Chat non connessa. Attendi qualche secondo.", "warning");
            this.aggiornaComposerChat?.();
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            this.mostraNotifica?.("Registrazione vocale non supportata da questo browser.", "warning");
            return;
        }
        const sessione = { room: window.stanzaAttuale, chunks: [], cancelled: false, finishing: false };
        this.registrazioneVocale = sessione;
        this.aggiornaFeedbackVocale('pending');
        try {
            // stream: Flusso acquisito dal browser dopo il consenso per le periferiche richieste.
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            sessione.stream = stream;
            // Un rilascio o un cambio stanza durante la richiesta dei permessi annulla l’avvio.
            if (this.registrazioneVocale !== sessione || sessione.cancelled ||
                sessione.room !== window.stanzaAttuale || !socket.connected) {
                this.pulisciRegistrazioneVocale(sessione);
                return;
            }
            const recorder = new MediaRecorder(stream);
            sessione.recorder = recorder;
            this.mediaRecorder = recorder;
            this.audioChunks = sessione.chunks;

            // Raccoglie i frammenti binari prodotti da MediaRecorder.
            // Riceve: event (evento del browser).
            recorder.ondataavailable = event => {
                if (event.data.size > 0) sessione.chunks.push(event.data);
            };

            // Completa il file audio dopo l’arresto della registrazione.
            // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
            recorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                window.clearInterval(sessione.timer);
                if (this.registrazioneVocale === sessione) this.staRegistrando = false;
                try {
                    if (sessione.cancelled || !sessione.chunks.length || sessione.room !== window.stanzaAttuale) return;
                    // Conserva il formato prodotto dal browser, compreso Safari su telefono.
                    const mimeType = recorder.mimeType || 'audio/webm';
                    const audioBlob = new Blob(sessione.chunks, { type: mimeType });
                    let ext = 'webm';
                    if (mimeType.includes('mp4')) ext = 'mp4';
                    else if (mimeType.includes('ogg')) ext = 'ogg';
                    else if (mimeType.includes('aac')) ext = 'aac';

                    sessione.finishing = true;
                    this.aggiornaFeedbackVocale('sending');
                    await this.inviaVocaleAlServer(audioBlob, ext, sessione.room);
                } finally {
                    this.pulisciRegistrazioneVocale(sessione);
                }
            };
            recorder.onerror = () => {
                sessione.cancelled = true;
                this.fermaRegistrazioneVocale(true);
                this.pulisciRegistrazioneVocale(sessione);
                this.mostraNotifica?.('Registrazione interrotta. Prova di nuovo.', 'error');
            };

            recorder.start();
            sessione.startedAt = Date.now();
            this.staRegistrando = true;
            this.aggiornaFeedbackVocale('recording');
            sessione.timer = window.setInterval(() => {
                const tempo = document.getElementById('tempo-registrazione-vocale');
                if (tempo) tempo.textContent = this.formattaTempoVocale((Date.now() - sessione.startedAt) / 1000);
            }, 250);
            this.timerRegistrazioneVocale = sessione.timer;
        } catch (err) {
            // err: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            const eraAttiva = this.registrazioneVocale === sessione && !sessione.cancelled;
            this.pulisciRegistrazioneVocale(sessione);
            if (eraAttiva) this.mostraNotifica?.(err.name === 'NotAllowedError'
                ? 'Permesso microfono negato.' : 'Microfono non disponibile. Prova di nuovo.', 'error');
        }
    },

    // fermaRegistrazioneVocale: Ferma il registratore in modo da completare il Blob del messaggio vocale.
    fermaRegistrazioneVocale(annulla = false) {
        const sessione = this.registrazioneVocale;
        if (!sessione || sessione.finishing) return;
        sessione.cancelled = sessione.cancelled || annulla || sessione.room !== window.stanzaAttuale;
        if (!sessione.recorder) {
            sessione.cancelled = true;
            this.pulisciRegistrazioneVocale(sessione);
            return;
        }
        sessione.finishing = true;
        this.staRegistrando = false;
        window.clearInterval(sessione.timer);
        this.aggiornaFeedbackVocale(sessione.cancelled ? 'idle' : 'sending');
        if (sessione.recorder.state !== 'inactive') {
            try { sessione.recorder.stop(); }
            catch { this.pulisciRegistrazioneVocale(sessione); }
        } else this.pulisciRegistrazioneVocale(sessione);
    },

    // inviaVocaleAlServer: Invia il Blob registrato come allegato e poi lo associa al messaggio della chat.
    // Riceve: blob (contenuto binario registrato); estensione (estensione del file audio).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async inviaVocaleAlServer(blob, estensione, room = window.stanzaAttuale) {
        if (!room) return;
        if (!socket.connected) {
            this.mostraNotifica?.("Connessione chat persa. Registra di nuovo il messaggio.", "warning");
            this.aggiornaComposerChat?.();
            return;
        }
        // formData: Contenitore multipart per campi del form e file binari.
        const formData = new FormData();
        
        formData.append('file_chat', blob, `vocale_${Date.now()}.${estensione}`);

        try {
            // uploadUrl: Endpoint dell’upload con la stanza corrente codificata nei parametri.
            const uploadUrl = `/api/chat/upload?room=${encodeURIComponent(room)}`;
            // risultato: Esito della richiesta al backend utilizzato per aggiornare l’interfaccia.
            const risultato = await this.apiRequest(uploadUrl, {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
                method: 'POST',
                body: formData,
                // timeout: Tempo massimo dell’operazione espresso in millisecondi.
                timeout: 30000
            });
            if (!socket.connected) {
                this.mostraNotifica?.("Connessione chat persa. Riprova tra qualche secondo.", "warning");
                return;
            }
            socket.emit('send_message', {
                room,
                contenuto: '',
                file_url: risultato.file_url,
                file_type: risultato.file_type,
                upload_token: risultato.upload_token
            });
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            if (typeof app.mostraNotifica === 'function') {
                app.mostraNotifica(
                    this.apiErrorMessage(error, 'Impossibile inviare il messaggio vocale.'),
                    'error'
                );
            }
        }
    }
});
