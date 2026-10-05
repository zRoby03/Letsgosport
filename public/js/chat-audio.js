window.app = window.app || {};

Object.assign(window.app, {

    generaPlayerAudio(messaggio) {
        messaggio.contenuto = ''; 
        const uiId = messaggio.id || 'vocale_' + Math.random().toString(36).substr(2, 9);
        const audioSrc = this.uploadSrc(messaggio.file_url, '');

        const player = this.creaElemento('div', { className: 'audio-player' });
        const playButton = this.creaElemento('button', {
            className: 'audio-player-toggle',
            attrs: {
                id: `btn-play-${uiId}`,
                type: 'button',
                'aria-label': 'Riproduci o metti in pausa il messaggio vocale'
            }
        });
        const playImage = this.creaElemento('img', {
            className: 'audio-player-toggle-icon',
            attrs: {
                id: `img-play-${uiId}`,
                src: 'uploads/buttons/tasto_audio_start.png',
                alt: ''
            }
        });
        playButton.appendChild(playImage);
        playButton.addEventListener('click', () => this.playPausaVocale(uiId));

        const timeline = this.creaElemento('div', { className: 'audio-player-timeline' });
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
        progress.addEventListener('input', () => this.scorriVocale(uiId, progress.value));

        const times = this.creaElemento('div', { className: 'audio-player-times' });
        const currentTime = this.creaElemento('span', {
            text: '0:00',
            attrs: { id: `time-current-${uiId}` }
        });
        const totalTime = this.creaElemento('span', {
            text: '--:--',
            attrs: { id: `time-total-${uiId}` }
        });
        times.append(currentTime, totalTime);
        timeline.append(progress, times);

        const audioIcon = this.creaElemento('img', {
            className: 'audio-player-icon',
            attrs: { src: 'uploads/buttons/tasto_audio.png', alt: '' }
        });
        const audio = this.creaElemento('audio', {
            attrs: {
                id: `audio-${uiId}`,
                src: audioSrc,
                preload: 'metadata'
            }
        });
        audio.addEventListener('error', () => {
            totalTime.textContent = 'Errore ⚠️';
            totalTime.classList.add('is-error');
        });
        audio.addEventListener('timeupdate', () => this.aggiornaTempoVocale(uiId));
        audio.addEventListener('loadedmetadata', () => this.impostaDurataVocale(uiId));
        audio.addEventListener('ended', () => this.resettaVocale(uiId));

        player.append(playButton, timeline, audioIcon, audio);
        return player;
    },

    playPausaVocale(id) {
        const audio = document.getElementById(`audio-${id}`);
        const imgPlay = document.getElementById(`img-play-${id}`);
        if (!audio || !imgPlay) return;
        
        if (!audio.paused) {
            audio.pause(); 
            imgPlay.src = 'uploads/buttons/tasto_audio_start.png';
        } else {
            document.querySelectorAll('audio').forEach(a => {
                if(a.id !== `audio-${id}` && a.id.startsWith('audio-')) {
                    a.pause();
                    const otherId = a.id.replace('audio-', '');
                    const otherImg = document.getElementById(`img-play-${otherId}`);
                    if(otherImg) otherImg.src = 'uploads/buttons/tasto_audio_start.png';
                }
            });
            
            audio.play().then(() => {
                imgPlay.src = 'uploads/buttons/tasto_audio_pausa.png';
            }).catch(e => {
                console.error("Errore riproduzione:", e);
                imgPlay.src = 'uploads/buttons/tasto_audio_start.png';
            });
        }
    },

    aggiornaTempoVocale(id) {
        const audio = document.getElementById(`audio-${id}`);
        const progress = document.getElementById(`progress-${id}`);
        const currentTimeEl = document.getElementById(`time-current-${id}`);
        if (!audio || !progress || !currentTimeEl) return;
        
        if (audio.duration && audio.duration !== Infinity) {
            progress.value = (audio.currentTime / audio.duration) * 100;
        }
        currentTimeEl.innerText = this.formattaTempoVocale(audio.currentTime);
    },

    impostaDurataVocale(id) {
        const audio = document.getElementById(`audio-${id}`);
        const totalTimeEl = document.getElementById(`time-total-${id}`);
        if(audio && totalTimeEl && audio.duration && audio.duration !== Infinity) {
            totalTimeEl.innerText = this.formattaTempoVocale(audio.duration);
        }
    },

    resettaVocale(id) {
        const imgPlay = document.getElementById(`img-play-${id}`);
        const progress = document.getElementById(`progress-${id}`);
        const currentTimeEl = document.getElementById(`time-current-${id}`);
        if(imgPlay) imgPlay.src = 'uploads/buttons/tasto_audio_start.png';
        if(progress) progress.value = 0;
        if(currentTimeEl) currentTimeEl.innerText = '0:00';
    },

    scorriVocale(id, percent) {
        const audio = document.getElementById(`audio-${id}`);
        if(audio && audio.duration && audio.duration !== Infinity) {
            audio.currentTime = (percent / 100) * audio.duration;
        }
    },

    formattaTempoVocale(seconds) {
        if (isNaN(seconds) || seconds === Infinity) return "0:00";
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    },

    mediaRecorder: null,
    audioChunks: [],
    staRegistrando: false,

    async iniziaRegistrazioneVocale() {
        if (this.staRegistrando) return;
        if (!socket.connected) {
            this.mostraNotifica?.("Chat non connessa. Attendi qualche secondo.", "warning");
            this.aggiornaComposerChat?.();
            return;
        }
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
            this.mostraNotifica?.("Registrazione vocale non supportata da questo browser.", "warning");
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = event => this.audioChunks.push(event.data);

            this.mediaRecorder.onstop = async () => {
                const mimeType = this.mediaRecorder.mimeType || 'audio/webm';
                const audioBlob = new Blob(this.audioChunks, { type: mimeType });
                
                let ext = 'webm';
                if (mimeType.includes('mp4')) ext = 'mp4';
                else if (mimeType.includes('ogg')) ext = 'ogg';
                else if (mimeType.includes('aac')) ext = 'aac';

                stream.getTracks().forEach(track => track.stop());
                await this.inviaVocaleAlServer(audioBlob, ext);
            };

            this.mediaRecorder.start();
            this.staRegistrando = true;
            
            const btn = document.getElementById('btn-registra-vocale');
            btn?.classList.add('is-recording');
        } catch (err) {
            console.error("Errore microfono:", err);
            if(typeof app.mostraNotifica === 'function') app.mostraNotifica("Permesso microfono negato.", "error");
        }
    },

    fermaRegistrazioneVocale() {
        if (!this.staRegistrando || !this.mediaRecorder) return;
        this.mediaRecorder.stop();
        this.staRegistrando = false;
        
        const btn = document.getElementById('btn-registra-vocale');
        btn?.classList.remove('is-recording');
    },

    async inviaVocaleAlServer(blob, estensione) {
        if (!window.stanzaAttuale) return; 
        if (!socket.connected) {
            this.mostraNotifica?.("Connessione chat persa. Registra di nuovo il messaggio.", "warning");
            this.aggiornaComposerChat?.();
            return;
        }
        const formData = new FormData();
        
        formData.append('file_chat', blob, `vocale_${Date.now()}.${estensione}`);

        try {
            const uploadUrl = `/api/chat/upload?room=${encodeURIComponent(window.stanzaAttuale || '')}`;
            const risultato = await this.apiRequest(uploadUrl, {
                method: 'POST',
                body: formData,
                timeout: 30000
            });
            if (!socket.connected) {
                this.mostraNotifica?.("Connessione chat persa. Riprova tra qualche secondo.", "warning");
                return;
            }
            socket.emit('send_message', {
                room: window.stanzaAttuale,
                contenuto: '',
                file_url: risultato.file_url,
                file_type: risultato.file_type,
                upload_token: risultato.upload_token
            });
        } catch (error) {
            if (typeof app.mostraNotifica === 'function') {
                app.mostraNotifica(
                    this.apiErrorMessage(error, 'Impossibile inviare il messaggio vocale.'),
                    'error'
                );
            }
        }
    }
});
