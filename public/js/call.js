window.app = window.app || {};

var socket = window.socket;

let peerConnection = null;
let localStream = null;
let remoteStream = null; 
let targetChiamataId = null;
let tempoInizioChiamata = null;
let chiamataInCorso = false; 
let callAttempt = null;
let remoteVideoEnabled = false;
let localDescriptionSent = false;
const incomingCandidates = [];
const outgoingCandidates = [];
const cameraConstraints = {
    width: { ideal: 640, max: 640 },
    height: { ideal: 480, max: 480 },
    frameRate: { ideal: 15, max: 15 }
};
const audioConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true };

const stunServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];

async function caricaServerIce() {
    const config = await app.apiRequest('/api/chiamate/ice', { timeout: 5000 }).catch(error => {
        app.mostraNotifica?.(error.message, 'warning');
        return null;
    });
    return stunServers.concat(Array.isArray(config?.iceServers) ? config.iceServers : []);
}

function fermaSquillo() {
    const audioSquillo = document.getElementById('suono-squillo');
    if (audioSquillo) {
        audioSquillo.pause();
        audioSquillo.currentTime = 0;
    }
}

async function aggiungiCandidate(connection, candidate) {
    try {
        await connection.addIceCandidate(candidate);
    } catch (error) {
        if (connection === peerConnection) console.warn('Impossibile aggiungere ICE candidate:', error);
    }
}

async function applicaCandidateInCoda(connection) {
    for (const candidate of incomingCandidates.splice(0)) {
        if (connection !== peerConnection) break;
        await aggiungiCandidate(connection, candidate);
    }
}

function inviaCandidate(candidate) {
    socket.emit('webrtc_ice_candidate', { targetId: targetChiamataId, candidate });
}

async function inviaDescrizione(connection, description) {
    await connection.setLocalDescription(description);
    if (connection !== peerConnection) return;
    const data = { targetId: targetChiamataId, sdp: connection.localDescription };
    if (description.type === 'offer') {
        const result = await socket.timeout(8000).emitWithAck('webrtc_offer', data);
        if (connection !== peerConnection) return;
        if (!result?.ok) throw new Error(result?.errore || 'Impossibile avviare la chiamata.');
    } else {
        socket.emit('webrtc_answer', data);
    }
    // L'offerta deve essere registrata dal server prima di inviare i candidati.
    localDescriptionSent = true;
    outgoingCandidates.splice(0).forEach(inviaCandidate);
}

function creaRoomPrivata(userId, targetId) {
    const primoId = Number(userId);
    const secondoId = Number(targetId);
    if (!Number.isInteger(primoId) || !Number.isInteger(secondoId) || primoId <= 0 || secondoId <= 0) {
        return null;
    }
    return `private_${Math.min(primoId, secondoId)}_${Math.max(primoId, secondoId)}`;
}

function aggiornaImmagine(id, src) {
    const immagine = document.getElementById(id);
    if (immagine && src) immagine.src = src;
}

function nomeStanzaPerChiamata(stanzaElement) {
    const nomeStanza = stanzaElement?.querySelector('.room-name')?.textContent?.trim();
    if (nomeStanza) return nomeStanza;
    const stanza = window.app.getStanzaChat?.(window.stanzaAttuale);
    if (stanza?.nome) return stanza.nome;
    return 'Utente';
}

socket.on('webrtc_offer', async (data) => {
    const callerId = Number(data?.callerId);
    if (!Number.isInteger(callerId) || callerId <= 0 || !data?.sdp) return;
    
    // Un'offerta dello stesso partecipante durante la chiamata è una rinegoziazione.
    if (chiamataInCorso && Number(targetChiamataId) === callerId && peerConnection) {
        const connection = peerConnection;
        try {
            await connection.setRemoteDescription(data.sdp);
            if (connection !== peerConnection) return;
            await applicaCandidateInCoda(connection);
            await inviaDescrizione(connection, await connection.createAnswer());
        } catch(e) { console.error("Errore rinegoziazione:", e); }
        return;
    }

    if (chiamataInCorso || targetChiamataId) return;

    const mioStato = localStorage.getItem('mioStatoDND') || 'ONLINE';
    if (mioStato === 'DND') {
        socket.emit('webrtc_end_call', { targetId: data.callerId });
        return; 
    }
    
    targetChiamataId = callerId;
    window._offertaRicevuta = data.sdp;
    
    const nomeChiamante = document.getElementById('chiamante-nome');
    const imgChiamante = document.getElementById('chiamante-img');

    if (nomeChiamante) nomeChiamante.innerText = data.callerName;
    if (imgChiamante) imgChiamante.src = app.uploadSrc(data.callerPropic);
    app._setIncomingModalVisible?.(true);

    const audioSquillo = document.getElementById('suono-squillo');
    if (audioSquillo) {
        audioSquillo.currentTime = 0;
        audioSquillo.play().catch(() => {});
    }
});

socket.on('webrtc_answer', async (data) => {
    const connection = peerConnection;
    if (!connection || Number(data?.answererId) !== targetChiamataId || !data?.sdp) return;
    try {
        await connection.setRemoteDescription(data.sdp);
        if (connection !== peerConnection) return;
        await applicaCandidateInCoda(connection);
        if (connection !== peerConnection) return;
        if (!tempoInizioChiamata) tempoInizioChiamata = Date.now();
        app._syncCallControls();
        app._emitAudioState();
    } catch (err) {
        console.error("Errore nell'impostare la risposta:", err);
    }
});

socket.on('webrtc_ice_candidate', async (data) => {
    if (!targetChiamataId || Number(data?.senderId) !== targetChiamataId || !data?.candidate) return;
    if (peerConnection?.remoteDescription) {
        await aggiungiCandidate(peerConnection, data.candidate);
    } else if (incomingCandidates.length < 128) {
        incomingCandidates.push(data.candidate);
    }
});

socket.on('webrtc_end_call', (data) => {
    if (data?.senderId && Number(data.senderId) !== Number(targetChiamataId)) return;
    const avevaChiamataAperta = chiamataInCorso || Boolean(targetChiamataId);
    fermaSquillo();
    if (avevaChiamataAperta && typeof app.mostraNotifica === 'function') {
        app.mostraNotifica("L'altra persona ha riattaccato.", "warning");
    }
    app.chiudiChiamata(false); 
});

socket.on('webrtc_toggle_video', (data) => {
    if (!targetChiamataId || Number(data?.senderId) !== targetChiamataId || typeof data.isVideoOn !== 'boolean') return;
    remoteVideoEnabled = data.isVideoOn;
    app._syncRemoteVideo();
});

socket.on('webrtc_audio_state', (data) => {
    if (!targetChiamataId || Number(data?.senderId) !== targetChiamataId) return;
    app._syncRemoteAudioState(data);
});

socket.on('webrtc_error', (data) => {
    if (typeof app.mostraNotifica === 'function') {
        app.mostraNotifica(data?.errore || 'Errore durante la chiamata.', 'error');
    }
    if (chiamataInCorso && !tempoInizioChiamata) {
        app.chiudiChiamata(false);
    }
});

Object.assign(window.app, {

    isScreenSharing: false,
    isScreenSharePending: false,
    screenStreamRef: null,
    cameraRequest: null,

    _mediaCallSupported() {
        return Boolean(
            window.RTCPeerConnection &&
            navigator.mediaDevices &&
            typeof navigator.mediaDevices.getUserMedia === 'function'
        );
    },

    _setMediaStream(elementId, stream) {
        const element = document.getElementById(elementId);
        if (element) element.srcObject = stream || null;
    },

    _getVideoTransceiver() {
        if (!peerConnection) return null;
        return peerConnection.getTransceivers().find(transceiver => (
            transceiver.sender?.track?.kind === 'video' ||
            transceiver.receiver?.track?.kind === 'video'
        )) || null;
    },

    async _renegotiateCall() {
        const connection = peerConnection;
        if (connection && targetChiamataId) await inviaDescrizione(connection, await connection.createOffer());
    },

    async _limitaInvioMedia(sender) {
        if (!sender?.track || !sender.getParameters || !sender.setParameters) return;
        try {
            const parameters = sender.getParameters();
            if (!parameters.encodings?.length) return;
            const video = sender.track.kind === 'video';
            for (const encoding of parameters.encodings) {
                encoding.maxBitrate = video ? 500000 : 32000;
                if (video) encoding.maxFramerate = 15;
            }
            await sender.setParameters(parameters);
        } catch (error) {
            console.warn('Limite di invio non applicabile in questo browser:', error.name);
        }
    },

    _emitRemoteVideoState(isVideoOn) {
        if (!targetChiamataId) return;
        socket.emit('webrtc_toggle_video', {
            targetId: targetChiamataId,
            isVideoOn: Boolean(isVideoOn)
        });
    },

    _emitAudioState() {
        if (!chiamataInCorso || !targetChiamataId) return;
        const remoteAudio = document.getElementById('audio-remoto');
        socket.emit('webrtc_audio_state', {
            targetId: targetChiamataId,
            micOn: Boolean(localStream?.getAudioTracks().some(track => track.enabled && track.readyState === 'live')),
            listening: !remoteAudio?.muted
        });
    },

    _syncRemoteAudioState({ micOn, listening } = {}) {
        const micBadge = document.getElementById('stato-microfono-remoto');
        const listeningBadge = document.getElementById('stato-ascolto-remoto');
        if (micBadge) micBadge.hidden = micOn !== false;
        if (listeningBadge) listeningBadge.hidden = listening !== false;
    },

    _syncRemoteVideo() {
        const video = document.getElementById('video-remoto');
        const track = video?.srcObject?.getVideoTracks()[0];
        const iceState = peerConnection?.iceConnectionState;
        const connected = iceState === 'connected' || iceState === 'completed';
        const showVideo = remoteVideoEnabled && connected && track?.readyState === 'live' &&
            !track.muted && !video.paused && video.readyState >= 2 && video.videoWidth > 0;
        document.getElementById('card-remota')?.classList.toggle('vc-video-off', !showVideo);
        const status = document.getElementById('stato-video-remoto');
        if (!status) return;
        if (iceState === 'failed') status.textContent = 'Connessione audio e video non riuscita';
        else if (!connected) status.textContent = 'Connessione audio e video in corso…';
        else if (remoteVideoEnabled) status.textContent = 'In attesa del video…';
        else status.textContent = 'Videocamera spenta';
    },

    async _playRemoteAudio() {
        const audio = document.getElementById('audio-remoto');
        const button = document.getElementById('btn-riproduci-audio-remoto');
        const stream = audio?.srcObject;
        if (!button || !stream) return;
        try {
            await audio.play();
            if (audio.srcObject === stream) button.hidden = true;
        } catch (error) {
            if (audio.srcObject === stream && error.name === 'NotAllowedError') button.hidden = false;
        }
    },

    _setCallModalVisible(visible) {
        const modal = document.getElementById('modale-videochiamata');
        if (!modal) return;
        modal.style.display = visible ? 'flex' : 'none';
        modal.setAttribute('aria-hidden', String(!visible));
    },

    _setIncomingModalVisible(visible) {
        const modal = document.getElementById('modale-chiamata-arrivo');
        if (!modal) return;
        modal.classList.toggle('active', visible);
        modal.style.display = visible ? 'flex' : 'none';
        modal.setAttribute('aria-hidden', String(!visible));
    },

    _stopMediaStream(stream) {
        if (!stream) return;
        stream.getTracks().forEach(track => {
            track.onended = null;
            track.stop();
            try {
                stream.removeTrack(track);
            } catch {
                // La traccia potrebbe essere già stata rimossa dal browser.
            }
        });
    },

    async _acquireInitialAudio() {
        if (!navigator.mediaDevices?.getUserMedia) {
            this.mostraNotifica?.('Microfono non supportato da questo browser.', 'warning');
            return null;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: audioConstraints
            });
            stream.getAudioTracks().forEach(track => {
                track.enabled = true;
                track.onended = () => {
                    this._syncCallControls();
                    this._emitAudioState();
                };
            });
            return stream;
        } catch (error) {
            this.mostraNotifica?.(
                error?.name === 'NotAllowedError'
                    ? 'Permesso microfono negato. La chiamata proseguirà senza audio in uscita.'
                    : 'Microfono non disponibile. La chiamata proseguirà senza audio in uscita.',
                'warning'
            );
            return null;
        }
    },

    _setCallControlState(buttonId, active, activeAsset, inactiveAsset, activeTitle, inactiveTitle) {
        const button = document.getElementById(buttonId);
        if (!button) return;

        button.classList.toggle('is-active', active);
        button.classList.toggle('spento', !active);
        button.setAttribute('aria-pressed', String(active));
        button.dataset.state = active ? 'active' : 'inactive';
        button.title = active ? activeTitle : inactiveTitle;

        const image = button.querySelector('img');
        if (image) image.src = active ? activeAsset : inactiveAsset;
    },

    _syncCallControls() {
        const audioTrack = localStream?.getAudioTracks().find(track => track.readyState === 'live');
        const videoTrack = localStream?.getVideoTracks().find(track => track.readyState === 'live');
        const screenTrack = this.screenStreamRef?.getVideoTracks().find(track => track.readyState === 'live');

        this._setCallControlState(
            'btn-toggle-audio',
            Boolean(audioTrack?.enabled),
            'uploads/buttons/tasto_mic_att.svg',
            'uploads/buttons/tasto_mic_disatt.svg',
            'Microfono attivo',
            'Microfono disattivato'
        );
        this._setCallControlState(
            'btn-toggle-video',
            Boolean(videoTrack?.enabled),
            'uploads/buttons/tasto_cam_att.svg',
            'uploads/buttons/tasto_cam_disatt.svg',
            'Videocamera attiva',
            'Videocamera disattivata'
        );
        this._setCallControlState(
            'btn-share-screen',
            Boolean(this.isScreenSharing && screenTrack),
            'uploads/buttons/tasto_schermo_att.svg',
            'uploads/buttons/tasto_schermo_disatt.svg',
            'Condivisione schermo attiva',
            'Condivisione schermo disattivata'
        );
        const cameraButton = document.getElementById('btn-toggle-video');
        const cameraSelect = document.getElementById('vc-camera-device');
        const cameraDisabled = !peerConnection?.remoteDescription || Boolean(this.cameraRequest) || this.isScreenSharePending;
        if (cameraButton) cameraButton.disabled = cameraDisabled;
        if (cameraSelect) cameraSelect.disabled = cameraDisabled;
        this._syncScreenShareAvailability();
    },

    _screenShareSupported() {
        return Boolean(
            navigator.mediaDevices &&
            typeof navigator.mediaDevices.getDisplayMedia === 'function'
        );
    },

    _syncScreenShareAvailability() {
        const button = document.getElementById('btn-share-screen');
        if (!button) return;

        const supported = this._screenShareSupported();
        button.classList.toggle('is-unavailable', !supported);
        button.classList.toggle('is-pending', this.isScreenSharePending);
        button.disabled = !supported || !peerConnection?.remoteDescription || this.isScreenSharePending || Boolean(this.cameraRequest);
        button.setAttribute('aria-disabled', String(!supported || this.isScreenSharePending));
        button.setAttribute('aria-busy', String(this.isScreenSharePending));

        if (!supported) {
            button.title = 'Condivisione schermo non supportata da questo browser';
            button.setAttribute('aria-label', 'Condivisione schermo non supportata');
        } else {
            button.setAttribute('aria-label', 'Condivisione schermo');
        }
    },

    _resetCallAudioOutput() {
        const remoteAudio = document.getElementById('audio-remoto');
        const button = document.getElementById('btn-toggle-deafen');
        const image = document.getElementById('img-toggle-deafen');

        if (remoteAudio) remoteAudio.muted = false;
        if (image) image.src = 'uploads/buttons/tasto_cuffie_att.svg';
        if (button) {
            button.classList.add('is-active');
            button.classList.remove('spento');
            button.setAttribute('aria-pressed', 'true');
            button.title = 'Audio chiamata attivo';
        }
    },

    _creaMotoreWebRTC(iceServers) {
        const connection = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });
        peerConnection = connection;
        remoteStream = new MediaStream();

        connection.ontrack = (event) => {
            if (connection !== peerConnection) return;
            const isAudio = event.track.kind === 'audio';
            const mediaId = isAudio ? 'audio-remoto' : 'video-remoto';
            remoteStream.addTrack(event.track);
            this._setMediaStream(mediaId, new MediaStream([event.track]));
            if (isAudio) {
                this._playRemoteAudio();
            } else {
                for (const name of ['mute', 'unmute', 'ended']) {
                    event.track.addEventListener(name, () => this._syncRemoteVideo());
                }
                document.getElementById(mediaId)?.play().catch(() => {});
                this._syncRemoteVideo();
            }
        };

        connection.onicecandidate = (event) => {
            if (connection !== peerConnection || !event.candidate) return;
            const candidate = event.candidate.toJSON();
            if (localDescriptionSent) inviaCandidate(candidate);
            else outgoingCandidates.push(candidate);
        };

        connection.oniceconnectionstatechange = () => {
            if (connection !== peerConnection) return;
            this._syncRemoteVideo();
            if (connection.iceConnectionState === 'failed') {
                this.mostraNotifica?.('Impossibile collegare audio e video tra i due dispositivi.', 'error');
            }
        };

        connection.onsignalingstatechange = () => {
            if (connection !== peerConnection || connection.signalingState !== 'stable') return;
            connection.getSenders().forEach(sender => this._limitaInvioMedia(sender));
        };

        return connection;
    },

    _preparaInterfacciaChiamata() {
        const sidebar = document.getElementById('vc-sidebar');
        const cardRemota = document.getElementById('card-remota');
        const cardLocale = document.getElementById('card-locale');
        const cardScreen = document.getElementById('card-screen');

        this.chiudiMenuMobile?.();

        if (sidebar) {
            if (cardRemota) sidebar.appendChild(cardRemota);
            if (cardLocale) sidebar.appendChild(cardLocale);
            if (cardScreen) {
                sidebar.appendChild(cardScreen);
                cardScreen.classList.add('hidden');
                cardScreen.classList.remove('is-screen-sharing');
            }
        }

        cardLocale?.classList.add('vc-video-off');
        cardRemota?.classList.add('vc-video-off');
        this._syncCallControls();
        this._resetCallAudioOutput();
        this._syncRemoteVideo();
        this.focusCard('card-remota');

        this._setCallModalVisible(true);
        document.body.classList.add('call-active');
    },

    _riordinaSidebar() {
        const sidebar = document.getElementById('vc-sidebar');
        if (!sidebar) return;
        
        const ordineCorretto = ['card-remota', 'card-locale', 'card-screen'];
        
        ordineCorretto.forEach(id => {
            const card = document.getElementById(id);
            if (card && card.parentElement === sidebar) {
                sidebar.appendChild(card); 
            }
        });
    },

    focusCard(cardId) {
        const card = document.getElementById(cardId);
        const mainFocus = document.getElementById('vc-main-focus');
        const sidebar = document.getElementById('vc-sidebar');

        if (!card || card.classList.contains('hidden')) return;

        if (card.parentElement === mainFocus) {
            return;
        }

        if (mainFocus.children.length > 0) {
            sidebar.appendChild(mainFocus.children[0]);
        }
        mainFocus.appendChild(card);
        this._riordinaSidebar();
    },

    async avviaChiamata() {
        if (
            chiamataInCorso || targetChiamataId ||
            typeof window.stanzaAttuale !== 'string' ||
            !window.stanzaAttuale.startsWith('private_')
        ) return;

        if (!this._mediaCallSupported()) {
            this.mostraNotifica?.('Questo browser non supporta le chiamate audio/video.', 'warning');
            return;
        }

        const ids = window.stanzaAttuale.replace('private_', '').split('_');
        targetChiamataId = Number(ids.find(id => String(id) !== String(window.app.mioId)));
        if (!Number.isInteger(targetChiamataId) || targetChiamataId <= 0) {
            targetChiamataId = null;
            this.mostraNotifica?.('Destinatario della chiamata non valido.', 'error');
            return;
        }

        chiamataInCorso = true;
        const attempt = callAttempt = Symbol();
        this.isScreenSharing = false;
        this.isScreenSharePending = false;
        this.screenStreamRef = null;
        
        const stanzaElement = document.getElementById(`nav-room-${window.stanzaAttuale}`);
        if (stanzaElement) {
            aggiornaImmagine('img-chiamata-remota', stanzaElement.querySelector('img')?.src);
            document.getElementById('nome-chiamata-remota').innerText = nomeStanzaPerChiamata(stanzaElement);
        }
        aggiornaImmagine('img-chiamata-locale', document.getElementById('img-propic')?.src);

        this._preparaInterfacciaChiamata();
        try {
            const [stream, iceServers] = await Promise.all([this._acquireInitialAudio(), caricaServerIce()]);
            if (attempt !== callAttempt) {
                this._stopMediaStream(stream);
                return;
            }
            localStream = stream;
            this._setMediaStream('video-locale', localStream);

            const connection = this._creaMotoreWebRTC(iceServers);
            connection.addTransceiver('video', { direction: 'sendrecv' });
            if (localStream) {
                localStream.getAudioTracks().forEach(track => connection.addTrack(track, localStream));
            } else {
                connection.addTransceiver('audio', { direction: 'sendrecv' });
            }
            this._syncCallControls();
            await inviaDescrizione(connection, await connection.createOffer());

        } catch (error) {
            if (attempt !== callAttempt) return;
            console.error('Errore avvio chiamata:', error);
            this.mostraNotifica?.(error.message || 'Impossibile avviare la chiamata.', 'error');
            this.chiudiChiamata();
        }
    },

    async accettaChiamata() {
        fermaSquillo();
        if (
            chiamataInCorso ||
            !Number.isInteger(Number(targetChiamataId)) ||
            Number(targetChiamataId) <= 0 ||
            !window._offertaRicevuta
        ) return;

        if (!this._mediaCallSupported()) {
            this.mostraNotifica?.('Questo browser non supporta le chiamate audio/video.', 'warning');
            this.rifiutaChiamata();
            return;
        }

        targetChiamataId = Number(targetChiamataId);
        chiamataInCorso = true;
        const attempt = callAttempt = Symbol();
        const offer = window._offertaRicevuta;
        this.isScreenSharing = false;
        this.isScreenSharePending = false;
        this.screenStreamRef = null;

        this._setIncomingModalVisible(false);

        const room_id = creaRoomPrivata(window.app.mioId, targetChiamataId);
        if (!room_id) {
            this.rifiutaChiamata();
            return;
        }
        
        const nomeChiamanteArrivo = document.getElementById('chiamante-nome');
        const nomeAltro = nomeChiamanteArrivo ? nomeChiamanteArrivo.innerText : "Utente";
        
        if (window.stanzaAttuale !== room_id && typeof app.cambiaStanzaChat === 'function') {
            app.cambiaStanzaChat(room_id, "👤 " + nomeAltro);
        }

        aggiornaImmagine('img-chiamata-locale', document.getElementById('img-propic')?.src);
        aggiornaImmagine('img-chiamata-remota', document.getElementById('chiamante-img')?.src);
        document.getElementById('nome-chiamata-remota').innerText = nomeAltro;

        this._preparaInterfacciaChiamata();
        try {
            const [stream, iceServers] = await Promise.all([this._acquireInitialAudio(), caricaServerIce()]);
            if (attempt !== callAttempt) {
                this._stopMediaStream(stream);
                return;
            }
            localStream = stream;
            this._setMediaStream('video-locale', localStream);
            const connection = this._creaMotoreWebRTC(iceServers);
            await connection.setRemoteDescription(offer);
            if (attempt !== callAttempt) return;
            await applicaCandidateInCoda(connection);
            if (attempt !== callAttempt) return;

            for (const transceiver of connection.getTransceivers()) {
                transceiver.direction = 'sendrecv';
                if (transceiver.receiver.track.kind === 'audio' && localStream) {
                    await transceiver.sender.replaceTrack(localStream.getAudioTracks()[0]);
                }
            }
            await inviaDescrizione(connection, await connection.createAnswer());
            if (attempt !== callAttempt) return;
            tempoInizioChiamata = Date.now(); 
            this._syncCallControls();
            this._emitAudioState();

        } catch (error) {
            if (attempt !== callAttempt) return;
            console.error("Errore risposta chiamata:", error);
            this.mostraNotifica?.('Impossibile rispondere alla chiamata.', 'error');
            this.chiudiChiamata();
        }
    },
            
    rifiutaChiamata() {
        this.chiudiChiamata();
    },

    chiudiChiamata(inviaSegnale = true) {
        fermaSquillo();
        if (inviaSegnale && tempoInizioChiamata && targetChiamataId) {
            const durataMs = Date.now() - tempoInizioChiamata;
            const minuti = Math.floor(durataMs / 60000);
            const secondi = Math.floor((durataMs % 60000) / 1000);
            const durataStr = `${minuti.toString().padStart(2, '0')}:${secondi.toString().padStart(2, '0')}`;
            const orarioFine = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            const room_id = creaRoomPrivata(window.app.mioId, targetChiamataId);

            if (room_id) {
                socket.emit('send_message', { room: room_id, contenuto: `📞 Chiamata terminata. Durata: ${durataStr} (Fine alle ${orarioFine})` });
            }
        }

        if (inviaSegnale && targetChiamataId) {
            socket.emit('webrtc_end_call', { targetId: targetChiamataId });
        }

        this._stopMediaStream(this.screenStreamRef);
        this._stopMediaStream(localStream);
        this._stopMediaStream(remoteStream);
        
        if (peerConnection) {
            peerConnection.ontrack = null;
            peerConnection.onicecandidate = null;
            peerConnection.oniceconnectionstatechange = null;
            peerConnection.close();
        }
        
        peerConnection = null;
        localStream = null;
        remoteStream = null;
        targetChiamataId = null;
        tempoInizioChiamata = null; 
        chiamataInCorso = false;
        callAttempt = null;
        localDescriptionSent = false;
        remoteVideoEnabled = false;
        this.isScreenSharing = false;
        this.isScreenSharePending = false;
        this.screenStreamRef = null;
        this.cameraRequest = null;
        const cameraSelect = document.getElementById('vc-camera-device');
        if (cameraSelect) {
            cameraSelect.replaceChildren();
            cameraSelect.hidden = true;
        }
        incomingCandidates.length = 0;
        outgoingCandidates.length = 0;
        window._offertaRicevuta = null;

        ['video-locale', 'video-remoto', 'video-screen', 'audio-remoto'].forEach(id => {
            const video = document.getElementById(id);
            if (video) {
                video.pause?.();
                video.srcObject = null;
            }
        });

        this._setCallModalVisible(false);
        this._setIncomingModalVisible(false);
        const audioButton = document.getElementById('btn-riproduci-audio-remoto');
        if (audioButton) audioButton.hidden = true;
        this._syncRemoteAudioState();
        document.getElementById('card-screen')?.classList.add('hidden');
        document.getElementById('card-screen')?.classList.remove('is-screen-sharing');
        document.getElementById('card-locale')?.classList.add('vc-video-off');
        document.getElementById('card-remota')?.classList.add('vc-video-off');
        document.body.classList.remove('call-active');
        this._syncCallControls();
        this._resetCallAudioOutput();
    },

    async toggleAudio() {
        const connection = peerConnection;
        if (!chiamataInCorso || !connection) return;
        let audioTrack = localStream?.getAudioTracks().find(track => track.readyState === 'live');

        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
        } else {
            if (!navigator.mediaDevices?.getUserMedia) {
                this.mostraNotifica?.('Microfono non supportato da questo browser.', 'warning');
                this._syncCallControls();
                return;
            }

            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                if (connection !== peerConnection) {
                    this._stopMediaStream(audioStream);
                    return;
                }
                audioTrack = audioStream.getAudioTracks()[0];

                if (!localStream) {
                    localStream = new MediaStream();
                    this._setMediaStream('video-locale', localStream);
                }
                for (const oldTrack of localStream.getAudioTracks()) localStream.removeTrack(oldTrack);
                localStream.addTrack(audioTrack);
                audioTrack.onended = () => {
                    this._syncCallControls();
                    this._emitAudioState();
                };

                if (peerConnection) {
                    const audioTransceiver = peerConnection.getTransceivers().find(
                        transceiver => transceiver.receiver?.track?.kind === 'audio'
                    );

                    if (audioTransceiver?.sender) {
                        const needsNegotiation = audioTransceiver.currentDirection === 'recvonly' ||
                            audioTransceiver.currentDirection === 'inactive';
                        audioTransceiver.direction = 'sendrecv';
                        await audioTransceiver.sender.replaceTrack(audioTrack);
                        if (needsNegotiation) await this._renegotiateCall();
                    } else {
                        peerConnection.addTrack(audioTrack, localStream);
                        await this._renegotiateCall();
                    }
                }
            } catch (error) {
                if (typeof this.mostraNotifica === 'function') {
                    this.mostraNotifica("Microfono bloccato o assente.", "warning");
                }
            }
        }
        this._syncCallControls();
        this._emitAudioState();
    },

    toggleDeafen() {
        const remoteAudio = document.getElementById('audio-remoto');
        let isMuted = false;
        
        if (remoteAudio) {
            remoteAudio.muted = !remoteAudio.muted;
            isMuted = remoteAudio.muted;
            if (!isMuted) this._playRemoteAudio();
        }

        const imgDeafen = document.getElementById('img-toggle-deafen');
        if (imgDeafen) {
            if (isMuted) {
                imgDeafen.src = 'uploads/buttons/tasto_cuffie_disatt.svg';
            } else {
                imgDeafen.src = 'uploads/buttons/tasto_cuffie_att.svg';
            }
        }

        const btnDeafen = document.getElementById('btn-toggle-deafen');
        if (btnDeafen) {
            btnDeafen.classList.toggle('is-active', !isMuted);
            btnDeafen.classList.toggle('spento', isMuted);
            btnDeafen.setAttribute('aria-pressed', String(!isMuted));
            btnDeafen.title = isMuted ? 'Audio chiamata disattivato' : 'Audio chiamata attivo';
        }
        this._emitAudioState();
    },

    async aggiornaElencoVideocamere() {
        const select = document.getElementById('vc-camera-device');
        const connection = peerConnection;
        if (!select || !connection || !navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (connection !== peerConnection) return;
        const cameras = devices.filter(device => device.kind === 'videoinput' && device.deviceId);
        const currentId = localStream?.getVideoTracks()[0]?.getSettings().deviceId || select.value;
        select.replaceChildren(...cameras.map((device, index) => (
            new Option(device.label || 'Videocamera ' + (index + 1), device.deviceId)
        )));
        if (cameras.some(device => device.deviceId === currentId)) select.value = currentId;
        select.hidden = cameras.length === 0;
    },

    async _attivaVideocamera(deviceId) {
        const connection = peerConnection;
        const videoSender = this._getVideoTransceiver()?.sender;
        if (!connection?.remoteDescription || !videoSender || this.cameraRequest || this.isScreenSharePending) return;
        const cardLocale = document.getElementById('card-locale');
        let acquiredStream;
        this.cameraRequest = connection;
        this._syncCallControls();
        try {
            acquiredStream = await navigator.mediaDevices.getUserMedia({
                video: { ...cameraConstraints, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }
            });
            if (connection !== peerConnection) return;
            const [track] = acquiredStream.getVideoTracks();
            if (!track || track.readyState !== 'live') throw new Error('Traccia video assente');
            if (!this.isScreenSharing) {
                await videoSender.replaceTrack(track);
                await this._limitaInvioMedia(videoSender);
            }
            if (connection !== peerConnection) return;

            if (!localStream) {
                localStream = new MediaStream();
                this._setMediaStream('video-locale', localStream);
            }
            for (const previous of localStream.getVideoTracks()) {
                previous.onended = null;
                previous.stop();
                localStream.removeTrack(previous);
            }
            localStream.addTrack(track);
            acquiredStream = null;
            track.onended = () => {
                cardLocale?.classList.add('vc-video-off');
                this._emitRemoteVideoState(this.isScreenSharing);
                this._syncCallControls();
            };
            cardLocale?.classList.remove('vc-video-off');
            this._emitRemoteVideoState(true);
        } catch (error) {
            if (connection === peerConnection) {
                console.error('Errore webcam:', error);
                this.mostraNotifica?.('Videocamera non disponibile. Controlla i permessi o scegli un altro dispositivo.', 'warning');
            }
        } finally {
            this._stopMediaStream(acquiredStream);
            if (this.cameraRequest === connection) await this.aggiornaElencoVideocamere();
            if (this.cameraRequest === connection) {
                this.cameraRequest = null;
                this._syncCallControls();
            }
        }
    },

    async toggleVideo() {
        if (!chiamataInCorso || !peerConnection?.remoteDescription || this.cameraRequest || this.isScreenSharePending) return;
        const selectedId = document.getElementById('vc-camera-device')?.value;
        const track = localStream?.getVideoTracks().find(candidate => candidate.readyState === 'live');
        if (!track || (!track.enabled && selectedId && track.getSettings().deviceId !== selectedId)) {
            await this._attivaVideocamera(selectedId);
            return;
        }
        track.enabled = !track.enabled;
        document.getElementById('card-locale')?.classList.toggle('vc-video-off', !track.enabled);
        this._emitRemoteVideoState(this.isScreenSharing || track.enabled);
        this._syncCallControls();
    },

    async condividiSchermo() {
        const connection = peerConnection;
        if (!chiamataInCorso || !connection?.remoteDescription || this.cameraRequest) return;

        const cardScreen = document.getElementById('card-screen');
        const videoScreen = document.getElementById('video-screen');
        const imgScreen = document.getElementById('img-share-screen');

        if (!this._screenShareSupported()) {
            this.isScreenSharing = false;
            this.isScreenSharePending = false;
            this.screenStreamRef = null;
            this._syncCallControls();
            if (typeof this.mostraNotifica === 'function') {
                this.mostraNotifica(
                    "La condivisione schermo non è supportata da questo browser o dispositivo.",
                    "warning"
                );
            }
            return;
        }

        if (this.isScreenSharePending) return;

        if (this.isScreenSharing) {
            const streamDaChiudere = this.screenStreamRef;
            this.isScreenSharing = false;
            this.isScreenSharePending = false;
            this.screenStreamRef = null;

            if (streamDaChiudere) {
                streamDaChiudere.getTracks().forEach(track => track.stop());
            }

            if (imgScreen) imgScreen.src = 'uploads/buttons/tasto_schermo_disatt.svg';

            if (cardScreen && cardScreen.parentElement?.id === 'vc-main-focus') {
                document.getElementById('vc-sidebar')?.appendChild(cardScreen);
            }
            if (cardScreen) {
                cardScreen.classList.add('hidden');
                cardScreen.classList.remove('is-screen-sharing');
            }
            if (videoScreen) videoScreen.srcObject = null;

            if (peerConnection) {
                const videoTransceiver = this._getVideoTransceiver();
                const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;

                if (videoTransceiver && videoTransceiver.sender) {
                    await videoTransceiver.sender.replaceTrack(videoTrack || null);
                }

                const isVideoOn = videoTrack ? videoTrack.enabled : false;
                this._emitRemoteVideoState(isVideoOn);
            }
            this.focusCard('card-remota');
            this._syncCallControls();
            return;
        }

        let screenStream = null;
        this.isScreenSharePending = true;
        this._syncCallControls();

        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { ideal: 10, max: 15 } }
            });
            if (connection !== peerConnection) {
                this._stopMediaStream(screenStream);
                return;
            }
            const screenTrack = screenStream.getVideoTracks()[0];

            if (!screenTrack || screenTrack.readyState !== 'live') {
                throw new Error('Nessuna traccia schermo disponibile');
            }

            this.isScreenSharing = true;
            this.isScreenSharePending = false;
            this.screenStreamRef = screenStream;

            if (imgScreen) imgScreen.src = 'uploads/buttons/tasto_schermo_att.svg';
            
            if (cardScreen) {
                cardScreen.classList.remove('hidden');
                cardScreen.classList.remove('vc-video-off');
                cardScreen.classList.add('is-screen-sharing');
            }
            if (videoScreen) videoScreen.srcObject = screenStream;
            
            this.focusCard('card-screen');
            this._syncCallControls();

            const videoTransceiver = this._getVideoTransceiver();
            if (videoTransceiver && videoTransceiver.sender) {
                await videoTransceiver.sender.replaceTrack(screenTrack);
                await this._limitaInvioMedia(videoTransceiver.sender);
            }

            this._emitRemoteVideoState(true);

            screenTrack.onended = async () => {
                if (this.screenStreamRef !== screenStream) return;

                this.isScreenSharing = false;
                this.isScreenSharePending = false;
                this.screenStreamRef = null;

                if (imgScreen) imgScreen.src = 'uploads/buttons/tasto_schermo_disatt.svg';

                if (cardScreen && cardScreen.parentElement?.id === 'vc-main-focus') {
                    document.getElementById('vc-sidebar')?.appendChild(cardScreen);
                }
                if (cardScreen) {
                    cardScreen.classList.add('hidden');
                    cardScreen.classList.remove('is-screen-sharing');
                }
                if (videoScreen) videoScreen.srcObject = null;
                
                const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;
                if (videoTransceiver && videoTransceiver.sender) {
                    await videoTransceiver.sender.replaceTrack(videoTrack || null);
                }

                const isVideoOn = videoTrack ? videoTrack.enabled : false;
                this._emitRemoteVideoState(isVideoOn);
                this.focusCard('card-remota');
                this._syncCallControls();
            };
            
        } catch (error) {
            this._stopMediaStream(screenStream);
            if (connection !== peerConnection) return;
            this.isScreenSharing = false;
            this.isScreenSharePending = false;
            this.screenStreamRef = null;
            if (imgScreen) imgScreen.src = 'uploads/buttons/tasto_schermo_disatt.svg';
            if (cardScreen && cardScreen.parentElement?.id === 'vc-main-focus') {
                document.getElementById('vc-sidebar')?.appendChild(cardScreen);
            }
            if (cardScreen) {
                cardScreen.classList.add('hidden');
                cardScreen.classList.remove('is-screen-sharing');
            }
            if (videoScreen) videoScreen.srcObject = null;
            this.focusCard('card-remota');
            this._syncCallControls();

            if (
                error?.name !== 'NotAllowedError' &&
                error?.name !== 'AbortError' &&
                typeof this.mostraNotifica === 'function'
            ) {
                this.mostraNotifica("Impossibile avviare la condivisione schermo.", "warning");
            }
        }
    }
});

function inizializzaControlliChiamata() {
    const handlers = {
        'btn-accetta-chiamata': () => app.accettaChiamata(),
        'btn-rifiuta-chiamata': () => app.rifiutaChiamata(),
        'btn-toggle-audio': () => app.toggleAudio(),
        'btn-toggle-deafen': () => app.toggleDeafen(),
        'btn-riproduci-audio-remoto': event => {
            event.stopPropagation();
            app._playRemoteAudio();
        },
        'btn-toggle-video': () => app.toggleVideo(),
        'btn-share-screen': () => app.condividiSchermo(),
        'btn-end-call': () => app.chiudiChiamata()
    };

    Object.entries(handlers).forEach(([id, handler]) => {
        document.getElementById(id)?.addEventListener('click', handler);
    });
    const remoteVideo = document.getElementById('video-remoto');
    for (const name of ['playing', 'loadeddata', 'resize', 'emptied']) {
        remoteVideo?.addEventListener(name, () => app._syncRemoteVideo());
    }
    const cameraSelect = document.getElementById('vc-camera-device');
    cameraSelect?.addEventListener('change', () => {
        if (localStream?.getVideoTracks().some(track => track.enabled && track.readyState === 'live')) {
            app._attivaVideocamera(cameraSelect.value);
        }
    });
    navigator.mediaDevices?.addEventListener('devicechange', () => {
        if (cameraSelect && !cameraSelect.hidden) app.aggiornaElencoVideocamere();
    });

    document.querySelectorAll('[data-focus-card]').forEach(card => {
        card.addEventListener('click', () => app.focusCard(card.dataset.focusCard));
    });

    app._syncCallControls();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inizializzaControlliChiamata, { once: true });
} else {
    inizializzaControlliChiamata();
}
