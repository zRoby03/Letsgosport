window.app = window.app || {};

var socket = window.socket;

let peerConnection = null;
let localStream = null;
let remoteStream = null; 
let targetChiamataId = null;
let tempoInizioChiamata = null;
let chiamataInCorso = false; 

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10 
};

function fermaSquillo() {
    const audioSquillo = document.getElementById('suono-squillo');
    if (audioSquillo) {
        audioSquillo.pause();
        audioSquillo.currentTime = 0;
    }
}

async function applicaCandidateInCoda() {
    if (!peerConnection || !window._candidateQueue) return;
    for (const candidate of window._candidateQueue) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
    window._candidateQueue = [];
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
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            await applicaCandidateInCoda();
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('webrtc_answer', { targetId: targetChiamataId, sdp: answer });
        } catch(e) { console.error("Errore rinegoziazione:", e); }
        return;
    }

    if (chiamataInCorso) return; 

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
    if (!peerConnection || Number(data?.answererId) !== Number(targetChiamataId) || !data?.sdp) return;
    try {
        if (!tempoInizioChiamata) tempoInizioChiamata = Date.now(); 
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await applicaCandidateInCoda();
    } catch (err) {
        console.error("Errore nell'impostare la risposta:", err);
    }
});

socket.on('webrtc_ice_candidate', async (data) => {
    if (peerConnection && Number(data?.senderId) === Number(targetChiamataId) && data?.candidate) {
        if (peerConnection.remoteDescription) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
                console.warn("Impossibile aggiungere ICE candidate:", err);
            }
        } else {
            if (!window._candidateQueue) window._candidateQueue = [];
            window._candidateQueue.push(data.candidate);
        }
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
    const isVideoOn = typeof data === 'boolean' ? data : data?.isVideoOn;
    if (
        typeof isVideoOn !== 'boolean' ||
        (data?.senderId && Number(data.senderId) !== Number(targetChiamataId))
    ) return;
    const cardRemota = document.getElementById('card-remota');
    if (cardRemota) {
        if (!isVideoOn) cardRemota.classList.add('vc-video-off');
        else cardRemota.classList.remove('vc-video-off');
    }
    const vid = document.getElementById('video-remoto');
    if (vid && isVideoOn) vid.srcObject = vid.srcObject;
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

    _mediaCallSupported() {
        return Boolean(
            window.RTCPeerConnection &&
            navigator.mediaDevices &&
            typeof navigator.mediaDevices.getUserMedia === 'function'
        );
    },

    _setVideoStream(videoId, stream) {
        const video = document.getElementById(videoId);
        if (video) video.srcObject = stream || null;
    },

    _getVideoTransceiver() {
        if (!peerConnection) return null;
        return peerConnection.getTransceivers().find(transceiver => (
            transceiver.sender?.track?.kind === 'video' ||
            transceiver.receiver?.track?.kind === 'video'
        )) || null;
    },

    async _renegotiateCall() {
        if (!peerConnection || !targetChiamataId) return;
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('webrtc_offer', {
            targetId: targetChiamataId,
            sdp: peerConnection.localDescription
        });
    },

    _emitRemoteVideoState(isVideoOn) {
        if (!targetChiamataId) return;
        socket.emit('webrtc_toggle_video', {
            targetId: targetChiamataId,
            isVideoOn: Boolean(isVideoOn)
        });
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
                audio: true
            });
            stream.getAudioTracks().forEach(track => {
                track.enabled = true;
                track.onended = () => this._syncCallControls();
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
            'uploads/buttons/tasto_mic_att.png',
            'uploads/buttons/tasto_mic_disatt.png',
            'Microfono attivo',
            'Microfono disattivato'
        );
        this._setCallControlState(
            'btn-toggle-video',
            Boolean(videoTrack?.enabled),
            'uploads/buttons/tasto_cam_att.png',
            'uploads/buttons/tasto_cam_disatt.png',
            'Videocamera attiva',
            'Videocamera disattivata'
        );
        this._setCallControlState(
            'btn-share-screen',
            Boolean(this.isScreenSharing && screenTrack),
            'uploads/buttons/tasto_schermo_att.png',
            'uploads/buttons/tasto_schermo_disatt.png',
            'Condivisione schermo attiva',
            'Condivisione schermo disattivata'
        );
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
        button.disabled = !supported || this.isScreenSharePending;
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
        const remoteVideo = document.getElementById('video-remoto');
        const button = document.getElementById('btn-toggle-deafen');
        const image = document.getElementById('img-toggle-deafen');

        if (remoteVideo) remoteVideo.muted = false;
        if (image) image.src = 'uploads/buttons/tasto_cuffie_att.png';
        if (button) {
            button.classList.add('is-active');
            button.classList.remove('spento');
            button.setAttribute('aria-pressed', 'true');
            button.title = 'Audio chiamata attivo';
        }
    },

    _creaMotoreWebRTC() {
        if (peerConnection) peerConnection.close();
        peerConnection = new RTCPeerConnection(rtcConfig);
        remoteStream = new MediaStream();
        window._candidateQueue = [];

        peerConnection.ontrack = (event) => {
            const videoRemoto = document.getElementById('video-remoto');
            remoteStream.addTrack(event.track);
            if (videoRemoto && videoRemoto.srcObject !== remoteStream) {
                videoRemoto.srcObject = remoteStream;
            }
        };

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc_ice_candidate', { targetId: targetChiamataId, candidate: event.candidate });
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            const stato = peerConnection.iceConnectionState;
            if (stato === 'disconnected' || stato === 'failed') {
                if (typeof this.mostraNotifica === 'function') this.mostraNotifica("Connessione di rete instabile...", "error");
            } else if (stato === 'closed') {
                this.chiudiChiamata(false);
            }
        };

        return peerConnection;
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
            chiamataInCorso ||
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
        this.isScreenSharing = false;
        this.isScreenSharePending = false;
        this.screenStreamRef = null;
        
        const stanzaElement = document.getElementById(`nav-room-${window.stanzaAttuale}`);
        if (stanzaElement) {
            aggiornaImmagine('img-chiamata-remota', stanzaElement.querySelector('img')?.src);
            document.getElementById('nome-chiamata-remota').innerText = nomeStanzaPerChiamata(stanzaElement);
        }
        aggiornaImmagine('img-chiamata-locale', document.getElementById('img-propic')?.src);

        try {
            localStream = await this._acquireInitialAudio();
            this._setVideoStream('video-locale', localStream);

            this._preparaInterfacciaChiamata();
            this._creaMotoreWebRTC();

            peerConnection.addTransceiver('video', { direction: 'sendrecv' });
            if (localStream) {
                localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
            } else {
                peerConnection.addTransceiver('audio', { direction: 'recvonly' });
            }

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('webrtc_offer', { targetId: targetChiamataId, sdp: offer });

        } catch (error) {
            console.error('Errore avvio chiamata:', error);
            this.mostraNotifica?.('Impossibile avviare la chiamata.', 'error');
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

        try {
            localStream = await this._acquireInitialAudio();
            this._setVideoStream('video-locale', localStream);

            this._preparaInterfacciaChiamata();
            this._creaMotoreWebRTC();

            if (localStream) {
                localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
            } else {
                peerConnection.addTransceiver('audio', { direction: 'recvonly' });
            }

            await peerConnection.setRemoteDescription(new RTCSessionDescription(window._offertaRicevuta));
            
            await applicaCandidateInCoda();
            
            const videoTransceiver = peerConnection.getTransceivers().find(t => t.receiver && t.receiver.track && t.receiver.track.kind === 'video');
            if (videoTransceiver) {
                videoTransceiver.direction = 'sendrecv';
            }

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('webrtc_answer', { targetId: targetChiamataId, sdp: answer });

            tempoInizioChiamata = Date.now(); 

        } catch (error) {
            console.error("Errore risposta chiamata:", error);
            this.chiudiChiamata();
        }
    },
            
    rifiutaChiamata() {
        fermaSquillo();
        this._setIncomingModalVisible(false);
        if (targetChiamataId) {
            socket.emit('webrtc_end_call', { targetId: targetChiamataId });
        }
        targetChiamataId = null;
        window._offertaRicevuta = null;
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
        this.isScreenSharing = false;
        this.isScreenSharePending = false;
        this.screenStreamRef = null;
        window._candidateQueue = [];
        window._offertaRicevuta = null;

        ['video-locale', 'video-remoto', 'video-screen'].forEach(id => {
            const video = document.getElementById(id);
            if (video) {
                video.pause?.();
                video.srcObject = null;
            }
        });

        this._setCallModalVisible(false);
        this._setIncomingModalVisible(false);
        document.getElementById('card-screen')?.classList.add('hidden');
        document.getElementById('card-screen')?.classList.remove('is-screen-sharing');
        document.getElementById('card-locale')?.classList.add('vc-video-off');
        document.getElementById('card-remota')?.classList.add('vc-video-off');
        document.body.classList.remove('call-active');
        this._syncCallControls();
        this._resetCallAudioOutput();
    },

    async toggleAudio() {
        if (!chiamataInCorso) return;
        let audioTrack = localStream?.getAudioTracks()[0];

        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
        } else {
            if (!navigator.mediaDevices?.getUserMedia) {
                this.mostraNotifica?.('Microfono non supportato da questo browser.', 'warning');
                this._syncCallControls();
                return;
            }

            try {
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                audioTrack = audioStream.getAudioTracks()[0];

                if (!localStream) {
                    localStream = new MediaStream();
                    this._setVideoStream('video-locale', localStream);
                }
                localStream.addTrack(audioTrack);
                audioTrack.onended = () => this._syncCallControls();

                if (peerConnection) {
                    const audioTransceiver = peerConnection.getTransceivers().find(
                        transceiver => transceiver.receiver?.track?.kind === 'audio'
                    );

                    if (audioTransceiver?.sender) {
                        audioTransceiver.direction = 'sendrecv';
                        await audioTransceiver.sender.replaceTrack(audioTrack);
                    } else {
                        peerConnection.addTrack(audioTrack, localStream);
                    }

                    await this._renegotiateCall();
                }
            } catch (error) {
                if (typeof this.mostraNotifica === 'function') {
                    this.mostraNotifica("Microfono bloccato o assente.", "warning");
                }
            }
        }
        this._syncCallControls();
    },

    toggleDeafen() {
        const videoRemoto = document.getElementById('video-remoto');
        let isMuted = false;
        
        if (videoRemoto) {
            videoRemoto.muted = !videoRemoto.muted;
            isMuted = videoRemoto.muted;
        }

        const imgDeafen = document.getElementById('img-toggle-deafen');
        if (imgDeafen) {
            if (isMuted) {
                imgDeafen.src = 'uploads/buttons/tasto_cuffie_disatt.png';
            } else {
                imgDeafen.src = 'uploads/buttons/tasto_cuffie_att.png';
            }
        }

        const btnDeafen = document.getElementById('btn-toggle-deafen');
        if (btnDeafen) {
            btnDeafen.classList.toggle('is-active', !isMuted);
            btnDeafen.classList.toggle('spento', isMuted);
            btnDeafen.setAttribute('aria-pressed', String(!isMuted));
            btnDeafen.title = isMuted ? 'Audio chiamata disattivato' : 'Audio chiamata attivo';
        }
    },

    async toggleVideo() {
        if (!chiamataInCorso) return;
        if (!navigator.mediaDevices?.getUserMedia) {
            this.mostraNotifica?.('Videocamera non supportata da questo browser.', 'warning');
            this._syncCallControls();
            return;
        }

        const cardLocale = document.getElementById('card-locale');
        let videoTrack = localStream ? localStream.getVideoTracks()[0] : null;
        let isOraAcceso = false;

        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            isOraAcceso = videoTrack.enabled;
            
            if (!videoTrack.enabled) cardLocale?.classList.add('vc-video-off');
            else cardLocale?.classList.remove('vc-video-off');
            this._emitRemoteVideoState(this.isScreenSharing || videoTrack.enabled);
        } else {
            try {
                const newVideoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                videoTrack = newVideoStream.getVideoTracks()[0];

                if (!localStream) {
                    localStream = new MediaStream();
                    this._setVideoStream('video-locale', localStream);
                }
                localStream.addTrack(videoTrack);

                if (peerConnection && !this.isScreenSharing) {
                    const videoTransceiver = this._getVideoTransceiver();
                    if (videoTransceiver && videoTransceiver.sender) {
                        videoTransceiver.direction = 'sendrecv'; 
                        await videoTransceiver.sender.replaceTrack(videoTrack);
                        
                        try {
                            await this._renegotiateCall();
                        } catch(err) { console.error(err); }
                    }
                }

                cardLocale?.classList.remove('vc-video-off');
                this._emitRemoteVideoState(true);
                isOraAcceso = true;
                videoTrack.onended = () => {
                    cardLocale?.classList.add('vc-video-off');
                    this._syncCallControls();
                    this._emitRemoteVideoState(this.isScreenSharing);
                };

            } catch (error) {
                console.error("Errore webcam:", error);
                if (typeof this.mostraNotifica === 'function') this.mostraNotifica("Webcam bloccata o assente.", "warning");
                this._syncCallControls();
                return;
            }
        }

        const imgCam = document.getElementById('img-toggle-video');
        if (imgCam) {
            if (isOraAcceso) {
                imgCam.src = 'uploads/buttons/tasto_cam_att.png';
            } else {
                imgCam.src = 'uploads/buttons/tasto_cam_disatt.png';
            }
        }
        this._syncCallControls();
    },

    async condividiSchermo() {
        if (!chiamataInCorso) return;

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

            if (imgScreen) imgScreen.src = 'uploads/buttons/tasto_schermo_disatt.png';

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
                    try {
                        await this._renegotiateCall();
                    } catch(err) {}
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
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];

            if (!screenTrack || screenTrack.readyState !== 'live') {
                throw new Error('Nessuna traccia schermo disponibile');
            }

            this.isScreenSharing = true;
            this.isScreenSharePending = false;
            this.screenStreamRef = screenStream;

            if (imgScreen) imgScreen.src = 'uploads/buttons/tasto_schermo_att.png';
            
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
                try {
                    await this._renegotiateCall();
                } catch(err) {}
            }

            this._emitRemoteVideoState(true);

            screenTrack.onended = async () => {
                if (this.screenStreamRef !== screenStream) return;

                this.isScreenSharing = false;
                this.isScreenSharePending = false;
                this.screenStreamRef = null;

                if (imgScreen) imgScreen.src = 'uploads/buttons/tasto_schermo_disatt.png';

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
                    try {
                        await this._renegotiateCall();
                    } catch(err) {}
                }

                const isVideoOn = videoTrack ? videoTrack.enabled : false;
                this._emitRemoteVideoState(isVideoOn);
                this.focusCard('card-remota');
                this._syncCallControls();
            };
            
        } catch (error) {
            if (screenStream) {
                screenStream.getTracks().forEach(track => track.stop());
            }
            this.isScreenSharing = false;
            this.isScreenSharePending = false;
            this.screenStreamRef = null;
            if (imgScreen) imgScreen.src = 'uploads/buttons/tasto_schermo_disatt.png';
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
        'btn-toggle-video': () => app.toggleVideo(),
        'btn-share-screen': () => app.condividiSchermo(),
        'btn-end-call': () => app.chiudiChiamata()
    };

    Object.entries(handlers).forEach(([id, handler]) => {
        document.getElementById(id)?.addEventListener('click', handler);
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
