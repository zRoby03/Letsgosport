// Frontend WebRTC: acquisisce microfono e webcam e scambia tramite Socket.IO offerte, risposte e candidati ICE.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Socket.IO trasporta il signaling; audio e video viaggiano tramite WebRTC su un percorso diretto o su un relay
// TURN.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
window.app = window.app || {};

// socket: Connessione Socket.IO condivisa con il client o con gli altri moduli del frontend.
var socket = window.socket;

// peerConnection: Connessione WebRTC della chiamata corrente, separata dal signaling Socket.IO.
let peerConnection = null;
// localStream: Flusso con le tracce acquisite sul dispositivo locale.
let localStream = null;
// remoteStream: Raccoglie le tracce ricevute dall’altro partecipante.
let remoteStream = null; 
// targetChiamataId: Identificativo dell’altra persona coinvolta nel tentativo di chiamata.
let targetChiamataId = null;
// tempoInizioChiamata: Istante del primo collegamento ICE riuscito, usato per calcolare la durata.
let tempoInizioChiamata = null;
// chiamataInCorso: Segnala che una chiamata o il relativo avvio sono già in corso.
let chiamataInCorso = false; 
// callAttempt: Identificatore del tentativo che consente di ignorare risposte di acquisizioni ormai superate.
let callAttempt = null;
// remoteVideoEnabled: Stato video dichiarato dall’altro partecipante tramite signaling.
let remoteVideoEnabled = false;
// localDescriptionSent: Indica se la descrizione locale è già stata inoltrata prima dei candidati ICE.
let localDescriptionSent = false;
// incomingCandidates: Candidati ICE ricevuti in anticipo, in attesa della descrizione remota.
const incomingCandidates = [];
// outgoingCandidates: Candidati ICE locali in attesa dell’invio della descrizione SDP.
const outgoingCandidates = [];
// cameraConstraints: Risoluzione e frequenza massime previste per il profilo di risparmio della webcam.
const cameraConstraints = {
    width: { ideal: 640, max: 640 },
    height: { ideal: 480, max: 480 },
    frameRate: { ideal: 15, max: 15 }
};
// audioConstraints: Preferenze per audio mono, cancellazione dell’eco e riduzione del rumore.
// channelCount: Numero di canali audio richiesto al dispositivo.
// echoCancellation: Richiede al browser la cancellazione dell’eco quando disponibile.
// noiseSuppression: Richiede al browser la riduzione del rumore quando disponibile.
const audioConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true };

// stunServers: Server STUN disponibili anche quando non è configurato un relay TURN.
const stunServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];

// caricaServerIce: Richiede le credenziali ICE al backend e le unisce ai server STUN già previsti.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function caricaServerIce() {
    // config: Risultato della richiesta HTTP attesa prima di proseguire.
    // timeout: Tempo massimo dell’operazione espresso in millisecondi.
    // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
    // Riceve: error (errore intercettato).
    const config = await app.apiRequest('/api/chiamate/ice', { timeout: 5000 }).catch(error => {
        app.mostraNotifica?.(error.message, 'warning');
        return null;
    });
    return stunServers.concat(Array.isArray(config?.iceServers) ? config.iceServers : []);
}

// fermaSquillo: Ferma e riporta all’inizio l’audio della chiamata in arrivo.
function fermaSquillo() {
    // audioSquillo: Elemento DOM suono-squillo: Elemento di riproduzione audio.
    const audioSquillo = document.getElementById('suono-squillo');
    if (audioSquillo) {
        audioSquillo.pause();
        audioSquillo.currentTime = 0;
    }
}

// aggiungiCandidate: Aggiunge un candidato ICE alla connessione e gestisce l’eventuale rifiuto del browser.
// Riceve: connection (connessione usata nell’operazione); candidate (candidato ICE).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function aggiungiCandidate(connection, candidate) {
    try {
        await connection.addIceCandidate(candidate);
    } catch (error) {
        // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        if (connection === peerConnection) console.warn('Impossibile aggiungere ICE candidate:', error);
    }
}

// applicaCandidateInCoda: Applica i candidati ricevuti prima che la descrizione remota fosse disponibile.
// Riceve: connection (connessione usata nell’operazione).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function applicaCandidateInCoda(connection) {
    // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
    // candidate: Riferimento o risultato da valorizzare durante l’operazione.
    for (const candidate of incomingCandidates.splice(0)) {
        if (connection !== peerConnection) break;
        await aggiungiCandidate(connection, candidate);
    }
}

// inviaCandidate: Invia all’altro partecipante il candidato ICE attraverso il signaling Socket.IO.
// Riceve: candidate (candidato ICE).
function inviaCandidate(candidate) {
    socket.emit('webrtc_ice_candidate', { targetId: targetChiamataId, candidate });
}

// inviaDescrizione: Imposta e inoltra offerta o risposta SDP, attendendo l’ACK prima dei candidati in uscita.
// Riceve: connection (connessione usata nell’operazione); description (descrizione SDP).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function inviaDescrizione(connection, description) {
    await connection.setLocalDescription(description);
    // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
    if (connection !== peerConnection) return;
    // data: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
    const data = { targetId: targetChiamataId, sdp: connection.localDescription };
    if (description.type === 'offer') {
        // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
        const result = await socket.timeout(8000).emitWithAck('webrtc_offer', data);
        // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
        if (connection !== peerConnection) return;
        if (!result?.ok) throw new Error(result?.errore || 'Impossibile avviare la chiamata.');
    } else {
        socket.emit('webrtc_answer', data);
    }
    // L'offerta deve essere registrata dal server prima di inviare i candidati.
    localDescriptionSent = true;
    outgoingCandidates.splice(0).forEach(inviaCandidate);
}

// creaRoomPrivata: Costruisce il nome canonico della chat privata ordinando gli identificativi dei due utenti.
// Riceve: userId (id dell’utente); targetId (id del destinatario).
function creaRoomPrivata(userId, targetId) {
    // primoId: Valore convertito o normalizzato prima del suo utilizzo.
    const primoId = Number(userId);
    // secondoId: Valore convertito o normalizzato prima del suo utilizzo.
    const secondoId = Number(targetId);
    if (!Number.isInteger(primoId) || !Number.isInteger(secondoId) || primoId <= 0 || secondoId <= 0) {
        return null;
    }
    return `private_${Math.min(primoId, secondoId)}_${Math.max(primoId, secondoId)}`;
}

// aggiornaImmagine: Aggiorna l’attributo src dell’immagine se elemento e indirizzo sono disponibili.
// Riceve: id (identificativo dell’elemento); src (indirizzo della risorsa).
function aggiornaImmagine(id, src) {
    // immagine: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
    const immagine = document.getElementById(id);
    if (immagine && src) immagine.src = src;
}

// nomeStanzaPerChiamata: Ricava il nome del destinatario dalla voce della chat o dai dati della stanza.
// Riceve: stanzaElement (voce DOM della stanza).
function nomeStanzaPerChiamata(stanzaElement) {
    // nomeStanza: Testo letto dall’elemento DOM e rifinito per questo utilizzo.
    const nomeStanza = stanzaElement?.querySelector('.room-name')?.textContent?.trim();
    if (nomeStanza) return nomeStanza;
    // stanza: Dati della stanza dopo il riconoscimento o il controllo degli accessi.
    const stanza = window.app.getStanzaChat?.(window.stanzaAttuale);
    if (stanza?.nome) return stanza.nome;
    return 'Utente';
}

// Gestisce l’offerta SDP che avvia o rinegozia la chiamata.
// Riceve: data (dati ricevuti).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
socket.on('webrtc_offer', async (data) => {
    // callerId: Identificativo dell’utente che avvia la chiamata.
    const callerId = Number(data?.callerId);
    if (!Number.isInteger(callerId) || callerId <= 0 || !data?.sdp) return;
    
    // Un'offerta dello stesso partecipante durante la chiamata è una rinegoziazione.
    // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
    if (chiamataInCorso && Number(targetChiamataId) === callerId && peerConnection) {
        // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
        const connection = peerConnection;
        // e: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        try {
            await connection.setRemoteDescription(data.sdp);
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection) return;
            await applicaCandidateInCoda(connection);
            await inviaDescrizione(connection, await connection.createAnswer());
        } catch(e) { console.error("Errore rinegoziazione:", e); }
        return;
    }

    if (chiamataInCorso || targetChiamataId) return;

    // mioStato: Preferenza locale online o non disturbare usata dalla chiamata.
    const mioStato = localStorage.getItem('mioStatoDND') || 'ONLINE';
    if (mioStato === 'DND') {
        socket.emit('webrtc_end_call', { targetId: data.callerId });
        return; 
    }
    
    targetChiamataId = callerId;
    window._offertaRicevuta = data.sdp;
    
    // nomeChiamante: Elemento DOM chiamante-nome: Titolo della sezione.
    const nomeChiamante = document.getElementById('chiamante-nome');
    // imgChiamante: Elemento DOM chiamante-img: Immagine dell’interfaccia.
    const imgChiamante = document.getElementById('chiamante-img');

    if (nomeChiamante) nomeChiamante.innerText = data.callerName;
    if (imgChiamante) imgChiamante.src = app.uploadSrc(data.callerPropic);
    app._setIncomingModalVisible?.(true);

    // audioSquillo: Elemento DOM suono-squillo: Elemento di riproduzione audio.
    const audioSquillo = document.getElementById('suono-squillo');
    if (audioSquillo) {
        audioSquillo.currentTime = 0;
        // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
        audioSquillo.play().catch(() => {});
    }
});

// Gestisce la risposta SDP necessaria a completare la negoziazione.
// Riceve: data (dati ricevuti).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
socket.on('webrtc_answer', async (data) => {
    // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
    const connection = peerConnection;
    if (!connection || Number(data?.answererId) !== targetChiamataId || !data?.sdp) return;
    try {
        await connection.setRemoteDescription(data.sdp);
        // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
        if (connection !== peerConnection) return;
        await applicaCandidateInCoda(connection);
        // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
        if (connection !== peerConnection) return;
        app._syncCallControls();
        app._emitAudioState();
    } catch (err) {
        // err: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
        console.error("Errore nell'impostare la risposta:", err);
    }
});

// Gestisce il candidato ICE che descrive un possibile percorso di rete.
// Riceve: data (dati ricevuti).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
socket.on('webrtc_ice_candidate', async (data) => {
    if (!targetChiamataId || Number(data?.senderId) !== targetChiamataId || !data?.candidate) return;
    if (peerConnection?.remoteDescription) {
        await aggiungiCandidate(peerConnection, data.candidate);
    } else if (incomingCandidates.length < 128) {
        incomingCandidates.push(data.candidate);
    }
});

// Gestisce la chiusura della chiamata comunicata dall’altro partecipante.
// Riceve: data (dati ricevuti).
socket.on('webrtc_end_call', (data) => {
    if (data?.senderId && Number(data.senderId) !== Number(targetChiamataId)) return;
    // avevaChiamataAperta: Ricorda se esisteva una chiamata o un tentativo prima della chiusura.
    const avevaChiamataAperta = chiamataInCorso || Boolean(targetChiamataId);
    fermaSquillo();
    if (avevaChiamataAperta && typeof app.mostraNotifica === 'function') {
        app.mostraNotifica("L'altra persona ha riattaccato.", "warning");
    }
    app.chiudiChiamata(false); 
});

// Sincronizza lo stato di attivazione del video dell’altro partecipante.
// Riceve: data (dati ricevuti).
socket.on('webrtc_toggle_video', (data) => {
    if (!targetChiamataId || Number(data?.senderId) !== targetChiamataId || typeof data.isVideoOn !== 'boolean') return;
    remoteVideoEnabled = data.isVideoOn;
    app._syncRemoteVideo();
});

// Sincronizza lo stato del microfono e dell’ascolto dell’altro partecipante.
// Riceve: data (dati ricevuti).
socket.on('webrtc_audio_state', (data) => {
    if (!targetChiamataId || Number(data?.senderId) !== targetChiamataId) return;
    app._syncRemoteAudioState(data);
});

// Mostra o inoltra un errore relativo al signaling o all’avvio della chiamata.
// Riceve: data (dati ricevuti).
socket.on('webrtc_error', (data) => {
    if (typeof app.mostraNotifica === 'function') {
        app.mostraNotifica(data?.errore || 'Errore durante la chiamata.', 'error');
    }
    if (chiamataInCorso && !tempoInizioChiamata) {
        app.chiudiChiamata(false);
    }
});

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {

    // isScreenSharing: Segnala se lo schermo sta sostituendo la traccia video inviata.
    isScreenSharing: false,
    // isScreenSharePending: Blocca richieste sovrapposte mentre il browser prepara la condivisione.
    isScreenSharePending: false,
    // screenStreamRef: Riferimento al flusso dello schermo, necessario per fermarlo e ripristinare la webcam.
    screenStreamRef: null,
    // cameraRequest: Riferimento alla connessione per riconoscere un’acquisizione webcam ancora valida.
    cameraRequest: null,
    // microphoneRequest: Riferimento alla connessione per impedire cambi di microfono sovrapposti.
    microphoneRequest: null,

    // _mediaCallSupported: Indica se il browser espone le API necessarie alle chiamate audio e video.
    _mediaCallSupported() {
        return Boolean(
            window.RTCPeerConnection &&
            navigator.mediaDevices &&
            typeof navigator.mediaDevices.getUserMedia === 'function'
        );
    },

    // _setMediaStream: Collega o scollega un MediaStream dall’elemento audio o video del DOM.
    // Riceve: elementId (id dell’elemento multimediale); stream (flusso multimediale).
    _setMediaStream(elementId, stream) {
        // element: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const element = document.getElementById(elementId);
        if (element) element.srcObject = stream || null;
    },

    // _getCallViewState: Restituisce lo stato necessario alla vista: connessione, inizio, nome e microfono.
    _getCallViewState() {
        // microphone: Traccia o controllo del microfono locale nel blocco corrente.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: track (traccia audio o video).
        const microphone = localStream?.getAudioTracks().find(track => track.readyState === 'live');
        return {
            connection: peerConnection,
            startedAt: tempoInizioChiamata,
            remoteName: document.getElementById('nome-chiamata-remota')?.textContent?.trim(),
            micOn: Boolean(microphone?.enabled),
            microphoneId: microphone?.getSettings?.().deviceId
        };
    },

    // _getVideoTransceiver: Trova il transceiver video, che riunisce invio e ricezione della stessa traccia negoziata.
    _getVideoTransceiver() {
        // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
        if (!peerConnection) return null;
        // Restituisce il criterio per individuare il primo elemento corrispondente.
        // Riceve: transceiver (canale WebRTC di invio e ricezione).
        return peerConnection.getTransceivers().find(transceiver => (
            transceiver.sender?.track?.kind === 'video' ||
            transceiver.receiver?.track?.kind === 'video'
        )) || null;
    },

    // _renegotiateCall: Invia una nuova offerta SDP per rinegoziare la chiamata già aperta.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async _renegotiateCall() {
        // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
        const connection = peerConnection;
        if (connection && targetChiamataId) await inviaDescrizione(connection, await connection.createOffer());
    },

    // _limitaInvioMedia: Prova ad applicare i limiti di bitrate e fotogrammi senza interrompere i browser che non li
    // accettano.
    // Riceve: sender (mittente RTP della traccia).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async _limitaInvioMedia(sender) {
        if (!sender?.track || !sender.getParameters || !sender.setParameters) return;
        try {
            // parameters: Risultato di getParameters. Restituisce i parametri RTP simulati da modificare o confrontare nella
            // prova.
            const parameters = sender.getParameters();
            if (!parameters.encodings?.length) return;
            // video: Elemento video su cui vengono verificati flusso e riproduzione.
            const video = sender.track.kind === 'video';
            // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
            // encoding: Riferimento o risultato da valorizzare durante l’operazione.
            for (const encoding of parameters.encodings) {
                encoding.maxBitrate = video ? 500000 : 32000;
                if (video) encoding.maxFramerate = 15;
            }
            await sender.setParameters(parameters);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            console.warn('Limite di invio non applicabile in questo browser:', error.name);
        }
    },

    // _emitRemoteVideoState: Comunica all’altro partecipante se è prevista la trasmissione video.
    // Riceve: isVideoOn (stato video da comunicare).
    _emitRemoteVideoState(isVideoOn) {
        if (!targetChiamataId) return;
        socket.emit('webrtc_toggle_video', {
            targetId: targetChiamataId,
            isVideoOn: Boolean(isVideoOn)
        });
    },

    // _emitAudioState: Comunica all’altro partecipante lo stato del microfono e dell’ascolto locale.
    _emitAudioState() {
        if (!chiamataInCorso || !targetChiamataId) return;
        // remoteAudio: Elemento DOM audio-remoto: Elemento di riproduzione audio.
        const remoteAudio = document.getElementById('audio-remoto');
        socket.emit('webrtc_audio_state', {
            targetId: targetChiamataId,
            // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
            // Riceve: track (traccia audio o video).
            micOn: Boolean(localStream?.getAudioTracks().some(track => track.enabled && track.readyState === 'live')),
            listening: !remoteAudio?.muted
        });
    },

    // _syncRemoteAudioState: Mostra o nasconde gli indicatori di microfono e ascolto disattivati dell’altra persona.
    // Riceve: micOn (stato del microfono); listening (stato dell’ascolto).
    _syncRemoteAudioState({ micOn, listening } = {}) {
        // micBadge: Elemento DOM stato-microfono-remoto: Etichetta o indicatore dell’interfaccia.
        const micBadge = document.getElementById('stato-microfono-remoto');
        // listeningBadge: Elemento DOM stato-ascolto-remoto: Etichetta o indicatore dell’interfaccia.
        const listeningBadge = document.getElementById('stato-ascolto-remoto');
        if (micBadge) micBadge.hidden = micOn !== false;
        if (listeningBadge) listeningBadge.hidden = listening !== false;
    },

    // _syncRemoteVideo: Mostra il video remoto solo quando traccia, connessione e riproduzione risultano utilizzabili.
    _syncRemoteVideo() {
        // video: Elemento DOM video-remoto: Riquadro video.
        const video = document.getElementById('video-remoto');
        // track: Traccia multimediale corrente in fase di verifica o sostituzione.
        const track = video?.srcObject?.getVideoTracks()[0];
        // iceState: Stato corrente del percorso di connessione WebRTC.
        const iceState = peerConnection?.iceConnectionState;
        // connected: Indica se il collegamento ICE è nello stato connesso previsto.
        const connected = iceState === 'connected' || iceState === 'completed';
        // showVideo: Indica se il video remoto è realmente pronto per essere mostrato.
        const showVideo = remoteVideoEnabled && connected && track?.readyState === 'live' &&
            !track.muted && !video.paused && video.readyState >= 2 && video.videoWidth > 0;
        document.getElementById('card-remota')?.classList.toggle('vc-video-off', !showVideo);
        // status: Elemento DOM stato-video-remoto: Contenitore dell’interfaccia.
        const status = document.getElementById('stato-video-remoto');
        if (!status) return;
        if (iceState === 'failed') status.textContent = 'Connessione audio e video non riuscita';
        else if (!connected) status.textContent = 'Connessione audio e video in corso…';
        else if (remoteVideoEnabled) status.textContent = 'In attesa del video…';
        else status.textContent = 'Videocamera spenta';
    },

    // _playRemoteAudio: Prova a riprodurre l’audio e propone l’attivazione manuale quando il browser blocca
    // l’autoplay.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async _playRemoteAudio() {
        // audio: Elemento DOM audio-remoto: Elemento di riproduzione audio.
        const audio = document.getElementById('audio-remoto');
        // button: Elemento DOM btn-riproduci-audio-remoto: Pulsante del controllo.
        const button = document.getElementById('btn-riproduci-audio-remoto');
        // stream: Valore della proprietà audio.srcObject, conservato per le operazioni successive.
        const stream = audio?.srcObject;
        if (!button || !stream) return;
        try {
            await audio.play();
            if (audio.srcObject === stream) button.hidden = true;
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            if (audio.srcObject === stream && error.name === 'NotAllowedError') button.hidden = false;
        }
    },

    // _setCallModalVisible: Aggiorna visibilità e attributi accessibili della schermata della chiamata.
    // Riceve: visible (visibilità desiderata).
    _setCallModalVisible(visible) {
        // modal: Elemento DOM modale-videochiamata: Contenitore dell’interfaccia.
        const modal = document.getElementById('modale-videochiamata');
        if (!modal) return;
        modal.style.display = visible ? 'flex' : 'none';
        modal.setAttribute('aria-hidden', String(!visible));
    },

    // _setIncomingModalVisible: Aggiorna visibilità e attributi accessibili della chiamata in arrivo.
    // Riceve: visible (visibilità desiderata).
    _setIncomingModalVisible(visible) {
        // modal: Elemento DOM modale-chiamata-arrivo: Contenitore dell’interfaccia.
        const modal = document.getElementById('modale-chiamata-arrivo');
        if (!modal) return;
        modal.classList.toggle('active', visible);
        modal.style.display = visible ? 'flex' : 'none';
        modal.setAttribute('aria-hidden', String(!visible));
    },

    // _stopMediaStream: Ferma le tracce dello stream e rimuove i riferimenti ai gestori di fine acquisizione.
    // Riceve: stream (flusso multimediale).
    _stopMediaStream(stream) {
        if (!stream) return;
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: track (traccia audio o video).
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

    // _acquireInitialAudio: Richiede il microfono iniziale; se manca il permesso consente alla chiamata di proseguire
    // senza invio audio.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async _acquireInitialAudio() {
        if (!navigator.mediaDevices?.getUserMedia) {
            this.mostraNotifica?.('Microfono non supportato da questo browser.', 'warning');
            return null;
        }

        try {
            // stream: Flusso acquisito dal browser dopo il consenso per le periferiche richieste.
            const stream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: audioConstraints
            });
            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: track (traccia audio o video).
            stream.getAudioTracks().forEach(track => {
                track.enabled = true;
                // Gestisce la fine della traccia e ripristina lo stato multimediale.
                track.onended = () => {
                    this._syncCallControls();
                    this._emitAudioState();
                };
            });
            return stream;
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this.mostraNotifica?.(
                error?.name === 'NotAllowedError'
                    ? 'Permesso microfono negato. La chiamata proseguirà senza audio in uscita.'
                    : 'Microfono non disponibile. La chiamata proseguirà senza audio in uscita.',
                'warning'
            );
            return null;
        }
    },

    // _setCallControlState: Allinea icona, classi, titolo e stato accessibile di un pulsante della chiamata.
    // Riceve: buttonId (id del pulsante); active (stato attivo del controllo); activeAsset (icona dello stato attivo);
    // inactiveAsset (icona dello stato disattivato); activeTitle (titolo dello stato attivo); inactiveTitle (titolo
    // dello stato disattivato).
    _setCallControlState(buttonId, active, activeAsset, inactiveAsset, activeTitle, inactiveTitle) {
        // button: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const button = document.getElementById(buttonId);
        if (!button) return;

        button.classList.toggle('is-active', active);
        button.classList.toggle('spento', !active);
        button.setAttribute('aria-pressed', String(active));
        button.dataset.state = active ? 'active' : 'inactive';
        button.title = active ? activeTitle : inactiveTitle;

        // image: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const image = button.querySelector('img');
        if (image) image.src = active ? activeAsset : inactiveAsset;
    },

    // _syncCallControls: Ricava lo stato reale delle tracce e aggiorna pulsanti, disponibilità e vista della chiamata.
    _syncCallControls() {
        // audioTrack: Traccia audio locale attiva o da aggiungere alla chiamata.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: track (traccia audio o video).
        const audioTrack = localStream?.getAudioTracks().find(track => track.readyState === 'live');
        // videoTrack: Traccia video locale da abilitare, disabilitare o ripristinare.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: track (traccia audio o video).
        const videoTrack = localStream?.getVideoTracks().find(track => track.readyState === 'live');
        // screenTrack: Traccia acquisita per condividere lo schermo.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: track (traccia audio o video).
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
        // cameraButton: Elemento DOM btn-toggle-video: Videocamera.
        const cameraButton = document.getElementById('btn-toggle-video');
        // cameraSelect: Elemento DOM vc-camera-device: Videocamera da usare.
        const cameraSelect = document.getElementById('vc-camera-device');
        // cameraDisabled: Determina se la webcam deve restare bloccata durante negoziazione o acquisizione.
        const cameraDisabled = !peerConnection?.remoteDescription || Boolean(this.cameraRequest) || this.isScreenSharePending;
        if (cameraButton) cameraButton.disabled = cameraDisabled;
        if (cameraSelect) cameraSelect.disabled = cameraDisabled;
        // microphoneButton: Elemento DOM btn-toggle-audio: Microfono.
        const microphoneButton = document.getElementById('btn-toggle-audio');
        if (microphoneButton) microphoneButton.disabled = !peerConnection || Boolean(this.microphoneRequest);
        this._syncScreenShareAvailability();
        window.callView?.sync(this._getCallViewState());
    },

    // _screenShareSupported: Indica se il browser offre l’API getDisplayMedia per condividere lo schermo.
    _screenShareSupported() {
        return Boolean(
            navigator.mediaDevices &&
            typeof navigator.mediaDevices.getDisplayMedia === 'function'
        );
    },

    // _syncScreenShareAvailability: Aggiorna pulsante e attributi accessibili in base a supporto e richieste di
    // acquisizione in corso.
    _syncScreenShareAvailability() {
        // button: Elemento DOM btn-share-screen: Condivisione schermo.
        const button = document.getElementById('btn-share-screen');
        if (!button) return;

        // supported: Risultato di _screenShareSupported. Indica se il browser offre l’API getDisplayMedia per condividere
        // lo schermo.
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

    // _resetCallAudioOutput: Ripristina l’ascolto e l’icona delle cuffie per una nuova chiamata.
    _resetCallAudioOutput() {
        // remoteAudio: Elemento DOM audio-remoto: Elemento di riproduzione audio.
        const remoteAudio = document.getElementById('audio-remoto');
        // button: Elemento DOM btn-toggle-deafen: Audio chiamata.
        const button = document.getElementById('btn-toggle-deafen');
        // image: Elemento DOM img-toggle-deafen: Immagine dell’interfaccia.
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

    // _creaMotoreWebRTC: Crea RTCPeerConnection e collega ricezione delle tracce, candidati ICE e cambi di stato.
    // Riceve: iceServers (server STUN e TURN disponibili).
    _creaMotoreWebRTC(iceServers) {
        // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
        // iceServers: Server STUN/TURN usati dal browser per trovare i percorsi di rete della chiamata.
        // iceTransportPolicy: Con all permette sia percorsi diretti sia relay, lasciando la selezione a ICE.
        const connection = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });
        peerConnection = connection;
        remoteStream = new MediaStream();

        // Riceve una traccia remota e la collega all’elemento audio o video corretto.
        // Riceve: event (evento del browser).
        connection.ontrack = (event) => {
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection) return;
            // isAudio: Indicatore booleano che controlla la condizione descritta dal nome.
            const isAudio = event.track.kind === 'audio';
            // mediaId: Valore scelto tra i due rami in base alla condizione indicata.
            const mediaId = isAudio ? 'audio-remoto' : 'video-remoto';
            remoteStream.addTrack(event.track);
            this._setMediaStream(mediaId, new MediaStream([event.track]));
            if (isAudio) {
                this._playRemoteAudio();
            } else {
                // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
                // name: Riferimento o risultato da valorizzare durante l’operazione.
                for (const name of ['mute', 'unmute', 'ended']) {
                    // Reagisce all’evento collegato aggiornando i dati o i controlli previsti.
                    event.track.addEventListener(name, () => this._syncRemoteVideo());
                }
                // Riceve una traccia remota e la collega all’elemento audio o video corretto.
                document.getElementById(mediaId)?.play().catch(() => {});
                this._syncRemoteVideo();
            }
        };

        // Inoltra o accoda il candidato ICE prodotto dal browser.
        // Riceve: event (evento del browser).
        connection.onicecandidate = (event) => {
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection || !event.candidate) return;
            // candidate: Risultato della chiamata event.candidate.toJSON, riutilizzato nelle istruzioni successive.
            const candidate = event.candidate.toJSON();
            if (localDescriptionSent) inviaCandidate(candidate);
            else outgoingCandidates.push(candidate);
        };

        // Aggiorna interfaccia e durata in base allo stato ICE effettivo.
        connection.oniceconnectionstatechange = () => {
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection) return;
            if (['connected', 'completed'].includes(connection.iceConnectionState) && !tempoInizioChiamata) {
                tempoInizioChiamata = Date.now();
            }
            this._syncRemoteVideo();
            this._syncCallControls();
            if (connection.iceConnectionState === 'failed') {
                this.mostraNotifica?.('Impossibile collegare audio e video tra i due dispositivi.', 'error');
            }
        };

        // Riapplica i limiti e aggiorna i controlli quando la negoziazione torna stabile.
        connection.onsignalingstatechange = () => {
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection || connection.signalingState !== 'stable') return;
            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: sender (mittente RTP della traccia).
            connection.getSenders().forEach(sender => this._limitaInvioMedia(sender));
            this._syncCallControls();
        };

        window.callView?.refreshDevices();
        return connection;
    },

    // _preparaInterfacciaChiamata: Ripristina i riquadri, mette il destinatario in primo piano e apre la schermata.
    _preparaInterfacciaChiamata() {
        // sidebar: Elemento DOM vc-sidebar: Contenitore dell’interfaccia.
        const sidebar = document.getElementById('vc-sidebar');
        // cardRemota: Elemento DOM card-remota: Contenitore dell’interfaccia.
        const cardRemota = document.getElementById('card-remota');
        // cardLocale: Elemento DOM card-locale: Contenitore dell’interfaccia.
        const cardLocale = document.getElementById('card-locale');
        // cardScreen: Elemento DOM card-screen: Contenitore dell’interfaccia.
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
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        window.callView?.open(() => this._getCallViewState());
    },

    // _riordinaSidebar: Mantiene un ordine coerente dei riquadri rimasti nella colonna delle anteprime.
    _riordinaSidebar() {
        // sidebar: Elemento DOM vc-sidebar: Contenitore dell’interfaccia.
        const sidebar = document.getElementById('vc-sidebar');
        if (!sidebar) return;
        
        // ordineCorretto: Elenco dei valori che questo blocco deve confrontare, mostrare o elaborare.
        const ordineCorretto = ['card-remota', 'card-locale', 'card-screen'];
        
        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: id (identificativo dell’elemento).
        ordineCorretto.forEach(id => {
            // card: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
            const card = document.getElementById(id);
            if (card && card.parentElement === sidebar) {
                sidebar.appendChild(card); 
            }
        });
    },

    // focusCard: Sposta il riquadro scelto nell’area principale e riporta il precedente nella colonna laterale.
    // Riceve: cardId (id del riquadro da mettere in primo piano).
    focusCard(cardId) {
        // card: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const card = document.getElementById(cardId);
        // mainFocus: Elemento DOM vc-main-focus: Contenitore dell’interfaccia.
        const mainFocus = document.getElementById('vc-main-focus');
        // sidebar: Elemento DOM vc-sidebar: Contenitore dell’interfaccia.
        const sidebar = document.getElementById('vc-sidebar');

        if (!card || !mainFocus || !sidebar || card.classList.contains('hidden')) return;
        window.callView?.setLayout('focus');

        if (card.parentElement === mainFocus) {
            return;
        }

        if (mainFocus.children.length > 0) {
            sidebar.appendChild(mainFocus.children[0]);
        }
        mainFocus.appendChild(card);
        this._riordinaSidebar();
    },

    // avviaChiamata: Prepara la chiamata in uscita, acquisisce l’audio e invia l’offerta SDP al destinatario.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
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

        // ids: Risultato della chiamata window.stanzaAttuale.replace.split, riutilizzato nelle istruzioni successive.
        const ids = window.stanzaAttuale.replace('private_', '').split('_');
        // Restituisce il criterio per individuare il primo elemento corrispondente.
        // Riceve: id (identificativo dell’elemento).
        targetChiamataId = Number(ids.find(id => String(id) !== String(window.app.mioId)));
        if (!Number.isInteger(targetChiamataId) || targetChiamataId <= 0) {
            targetChiamataId = null;
            this.mostraNotifica?.('Destinatario della chiamata non valido.', 'error');
            return;
        }

        chiamataInCorso = true;
        // attempt: Identificatore del tentativo da ricontrollare dopo le attese asincrone.
        const attempt = callAttempt = Symbol();
        this.isScreenSharing = false;
        this.isScreenSharePending = false;
        this.screenStreamRef = null;
        
        // stanzaElement: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const stanzaElement = document.getElementById(`nav-room-${window.stanzaAttuale}`);
        if (stanzaElement) {
            aggiornaImmagine('img-chiamata-remota', stanzaElement.querySelector('img')?.src);
            document.getElementById('nome-chiamata-remota').innerText = nomeStanzaPerChiamata(stanzaElement);
        }
        aggiornaImmagine('img-chiamata-locale', document.getElementById('img-propic')?.src);

        this._preparaInterfacciaChiamata();
        try {
            // stream: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            // iceServers: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            const [stream, iceServers] = await Promise.all([this._acquireInitialAudio(), caricaServerIce()]);
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (attempt !== callAttempt) {
                this._stopMediaStream(stream);
                return;
            }
            localStream = stream;
            this._setMediaStream('video-locale', localStream);

            // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
            const connection = this._creaMotoreWebRTC(iceServers);
            connection.addTransceiver('video', { direction: 'sendrecv' });
            if (localStream) {
                // Applica l’operazione del blocco a ciascun elemento della raccolta.
                // Riceve: track (traccia audio o video).
                localStream.getAudioTracks().forEach(track => connection.addTrack(track, localStream));
            } else {
                connection.addTransceiver('audio', { direction: 'sendrecv' });
            }
            this._syncCallControls();
            await inviaDescrizione(connection, await connection.createOffer());

        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (attempt !== callAttempt) return;
            console.error('Errore avvio chiamata:', error);
            this.mostraNotifica?.(error.message || 'Impossibile avviare la chiamata.', 'error');
            this.chiudiChiamata();
        }
    },

    // accettaChiamata: Accetta l’offerta ricevuta, prepara le tracce e invia la risposta SDP.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
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
        // attempt: Identificatore del tentativo da ricontrollare dopo le attese asincrone.
        const attempt = callAttempt = Symbol();
        // offer: Valore della proprietà window._offertaRicevuta, conservato per le operazioni successive.
        const offer = window._offertaRicevuta;
        this.isScreenSharing = false;
        this.isScreenSharePending = false;
        this.screenStreamRef = null;

        this._setIncomingModalVisible(false);

        // room_id: Nome della stanza chat usato dagli eventi Socket.IO.
        const room_id = creaRoomPrivata(window.app.mioId, targetChiamataId);
        if (!room_id) {
            this.rifiutaChiamata();
            return;
        }
        
        // nomeChiamanteArrivo: Elemento DOM chiamante-nome: Titolo della sezione.
        const nomeChiamanteArrivo = document.getElementById('chiamante-nome');
        // nomeAltro: Valore scelto tra i due rami in base alla condizione indicata.
        const nomeAltro = nomeChiamanteArrivo ? nomeChiamanteArrivo.innerText : "Utente";
        
        if (window.stanzaAttuale !== room_id && typeof app.cambiaStanzaChat === 'function') {
            app.cambiaStanzaChat(room_id, "👤 " + nomeAltro);
        }

        aggiornaImmagine('img-chiamata-locale', document.getElementById('img-propic')?.src);
        aggiornaImmagine('img-chiamata-remota', document.getElementById('chiamante-img')?.src);
        document.getElementById('nome-chiamata-remota').innerText = nomeAltro;

        this._preparaInterfacciaChiamata();
        try {
            // stream: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            // iceServers: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
            const [stream, iceServers] = await Promise.all([this._acquireInitialAudio(), caricaServerIce()]);
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (attempt !== callAttempt) {
                this._stopMediaStream(stream);
                return;
            }
            localStream = stream;
            this._setMediaStream('video-locale', localStream);
            // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
            const connection = this._creaMotoreWebRTC(iceServers);
            await connection.setRemoteDescription(offer);
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (attempt !== callAttempt) return;
            await applicaCandidateInCoda(connection);
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (attempt !== callAttempt) return;

            // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
            // transceiver: Riferimento o risultato da valorizzare durante l’operazione.
            for (const transceiver of connection.getTransceivers()) {
                transceiver.direction = 'sendrecv';
                if (transceiver.receiver.track.kind === 'audio' && localStream) {
                    await transceiver.sender.replaceTrack(localStream.getAudioTracks()[0]);
                }
            }
            await inviaDescrizione(connection, await connection.createAnswer());
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (attempt !== callAttempt) return;
            this._syncCallControls();
            this._emitAudioState();

        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (attempt !== callAttempt) return;
            console.error("Errore risposta chiamata:", error);
            this.mostraNotifica?.('Impossibile rispondere alla chiamata.', 'error');
            this.chiudiChiamata();
        }
    },
            
    // rifiutaChiamata: Chiude il tentativo di chiamata e invia il segnale previsto al chiamante.
    rifiutaChiamata() {
        this.chiudiChiamata();
    },

    // chiudiChiamata: Termina signaling e media, chiude la connessione e ripristina lo stato dell’interfaccia.
    // Riceve: inviaSegnale (se avvisare l’altro partecipante).
    chiudiChiamata(inviaSegnale = true) {
        fermaSquillo();
        window.callView?.close();
        if (inviaSegnale && tempoInizioChiamata && targetChiamataId) {
            // durataMs: Durata trascorsa espressa in millisecondi.
            const durataMs = Date.now() - tempoInizioChiamata;
            // minuti: Risultato della chiamata Math.floor, riutilizzato nelle istruzioni successive.
            const minuti = Math.floor(durataMs / 60000);
            // secondi: Risultato della chiamata Math.floor, riutilizzato nelle istruzioni successive.
            const secondi = Math.floor((durataMs % 60000) / 1000);
            // durataStr: Durata della chiamata già formattata per il messaggio finale.
            const durataStr = `${minuti.toString().padStart(2, '0')}:${secondi.toString().padStart(2, '0')}`;
            // orarioFine: Orario locale in cui la chiamata termina.
            const orarioFine = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            // room_id: Nome della stanza chat usato dagli eventi Socket.IO.
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
            peerConnection.onsignalingstatechange = null;
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
        this.microphoneRequest = null;
        // cameraSelect: Elemento DOM vc-camera-device: Videocamera da usare.
        const cameraSelect = document.getElementById('vc-camera-device');
        if (cameraSelect) {
            cameraSelect.replaceChildren();
            cameraSelect.hidden = true;
        }
        incomingCandidates.length = 0;
        outgoingCandidates.length = 0;
        window._offertaRicevuta = null;

        // Applica l’operazione del blocco a ciascun elemento della raccolta.
        // Riceve: id (identificativo dell’elemento).
        ['video-locale', 'video-remoto', 'video-screen', 'audio-remoto'].forEach(id => {
            // video: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
            const video = document.getElementById(id);
            if (video) {
                video.pause?.();
                video.srcObject = null;
            }
        });

        this._setCallModalVisible(false);
        this._setIncomingModalVisible(false);
        // audioButton: Elemento DOM btn-riproduci-audio-remoto: Pulsante del controllo.
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

    // toggleAudio: Attiva o disattiva il microfono, acquisendolo se non esiste ancora una traccia utilizzabile.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async toggleAudio() {
        // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
        const connection = peerConnection;
        if (!chiamataInCorso || !connection || this.microphoneRequest) return;
        // audioTrack: Traccia audio locale attiva o da aggiungere alla chiamata.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: track (traccia audio o video).
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
                // audioStream: Flusso acquisito dal browser dopo il consenso per le periferiche richieste.
                const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
                if (connection !== peerConnection) {
                    this._stopMediaStream(audioStream);
                    return;
                }
                audioTrack = audioStream.getAudioTracks()[0];

                if (!localStream) {
                    localStream = new MediaStream();
                    this._setMediaStream('video-locale', localStream);
                }
                // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
                // oldTrack: Traccia precedente conservata dal test per verificare la sostituzione.
                for (const oldTrack of localStream.getAudioTracks()) localStream.removeTrack(oldTrack);
                localStream.addTrack(audioTrack);
                // Gestisce la fine della traccia e ripristina lo stato multimediale.
                audioTrack.onended = () => {
                    this._syncCallControls();
                    this._emitAudioState();
                };

                if (peerConnection) {
                    // audioTransceiver: Canale WebRTC che associa invio e ricezione dell’audio negoziato.
                    const audioTransceiver = peerConnection.getTransceivers().find(
                        // Restituisce il criterio per individuare il primo elemento corrispondente.
                        // Riceve: transceiver (canale WebRTC di invio e ricezione).
                        transceiver => transceiver.receiver?.track?.kind === 'audio'
                    );

                    if (audioTransceiver?.sender) {
                        // needsNegotiation: Indica se la modifica delle tracce richiede un nuovo scambio SDP.
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
                // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
                if (typeof this.mostraNotifica === 'function') {
                    this.mostraNotifica("Microfono bloccato o assente.", "warning");
                }
            }
        }
        this._syncCallControls();
        this._emitAudioState();
    },

    // cambiaMicrofonoChiamata: Sostituisce il microfono senza perdere il mute e rilascia le acquisizioni terminate
    // dopo la chiusura.
    // Riceve: deviceId (id della periferica scelta).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async cambiaMicrofonoChiamata(deviceId) {
        // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
        const connection = peerConnection;
        if (!connection?.remoteDescription || !deviceId || this.microphoneRequest) return;
        // transceiver: Primo elemento della raccolta che soddisfa il criterio richiesto.
        // Restituisce il criterio per individuare il primo elemento corrispondente.
        // Riceve: item (elemento corrente).
        const transceiver = connection.getTransceivers().find(item =>
            item.sender?.track?.kind === 'audio' || item.receiver?.track?.kind === 'audio');
        if (!transceiver?.sender) return;
        // sender: Mittente RTP che trasporta la traccia verso l’altro partecipante.
        const sender = transceiver.sender;
        // previous: Riferimento precedente da ripristinare o verificare prima della sostituzione.
        const previous = sender.track;
        // previousDirection: Direzione del transceiver conservata per il ripristino in caso di errore.
        const previousDirection = transceiver.direction;
        // stream: Riferimento o risultato da valorizzare durante l’operazione.
        let stream;
        // replaced: Indica se la nuova traccia ha già sostituito quella del mittente RTP.
        let replaced = false;
        this.microphoneRequest = connection;
        this._syncCallControls();
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { ...audioConstraints, deviceId: { exact: deviceId } },
                video: false
            });
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection) return;
            // track: Traccia multimediale corrente in fase di verifica o sostituzione.
            const track = stream.getAudioTracks()[0];
            if (!track || track.readyState !== 'live') throw new Error('Microfono non disponibile');
            track.enabled = previous?.readyState === 'live' ? previous.enabled : true;
            await sender.replaceTrack(track);
            replaced = true;
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection) return;
            if (['recvonly', 'inactive'].includes(transceiver.currentDirection)) {
                transceiver.direction = 'sendrecv';
                await this._renegotiateCall();
            }
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection) return;
            if (!localStream) {
                localStream = new MediaStream();
                this._setMediaStream('video-locale', localStream);
            }
            // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
            // oldTrack: Traccia precedente conservata dal test per verificare la sostituzione.
            for (const oldTrack of localStream.getAudioTracks()) {
                oldTrack.onended = null;
                localStream.removeTrack(oldTrack);
                oldTrack.stop();
            }
            localStream.addTrack(track);
            // Gestisce la fine della traccia e ripristina lo stato multimediale.
            track.onended = () => {
                this._syncCallControls();
                this._emitAudioState();
            };
            stream = null;
            await this._limitaInvioMedia(sender);
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection) return;
            // feedback: Elemento DOM vc-device-feedback: Testo informativo.
            const feedback = document.getElementById('vc-device-feedback');
            if (feedback) feedback.textContent = 'Microfono aggiornato.';
        } catch {
            if (connection === peerConnection) {
                if (replaced) {
                    transceiver.direction = previousDirection;
                    // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
                    await sender.replaceTrack(previous?.readyState === 'live' ? previous : null).catch(() => {});
                }
                // feedback: Elemento DOM vc-device-feedback: Testo informativo.
                const feedback = document.getElementById('vc-device-feedback');
                if (feedback) feedback.textContent = 'Microfono non disponibile. Il dispositivo precedente resta selezionato.';
                this.mostraNotifica?.('Impossibile cambiare microfono. Controlla il dispositivo e i permessi.', 'warning');
            }
        } finally {
            this._stopMediaStream(stream);
            if (this.microphoneRequest === connection) {
                this.microphoneRequest = null;
                this._syncCallControls();
                this._emitAudioState();
                window.callView?.refreshDevices();
            }
        }
    },

    // toggleDeafen: Attiva o disattiva l’ascolto dell’altra persona e comunica il nuovo stato.
    toggleDeafen() {
        // remoteAudio: Elemento DOM audio-remoto: Elemento di riproduzione audio.
        const remoteAudio = document.getElementById('audio-remoto');
        // isMuted: Indicatore booleano che controlla la condizione descritta dal nome.
        let isMuted = false;
        
        if (remoteAudio) {
            remoteAudio.muted = !remoteAudio.muted;
            isMuted = remoteAudio.muted;
            if (!isMuted) this._playRemoteAudio();
        }

        // imgDeafen: Elemento DOM img-toggle-deafen: Immagine dell’interfaccia.
        const imgDeafen = document.getElementById('img-toggle-deafen');
        if (imgDeafen) {
            if (isMuted) {
                imgDeafen.src = 'uploads/buttons/tasto_cuffie_disatt.svg';
            } else {
                imgDeafen.src = 'uploads/buttons/tasto_cuffie_att.svg';
            }
        }

        // btnDeafen: Elemento DOM btn-toggle-deafen: Audio chiamata.
        const btnDeafen = document.getElementById('btn-toggle-deafen');
        if (btnDeafen) {
            btnDeafen.classList.toggle('is-active', !isMuted);
            btnDeafen.classList.toggle('spento', isMuted);
            btnDeafen.setAttribute('aria-pressed', String(!isMuted));
            btnDeafen.title = isMuted ? 'Audio chiamata disattivato' : 'Audio chiamata attivo';
        }
        this._emitAudioState();
    },

    // aggiornaElencoVideocamere: Enumera le webcam disponibili e conserva la selezione del dispositivo attuale.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async aggiornaElencoVideocamere() {
        // select: Elemento DOM vc-camera-device: Videocamera da usare.
        const select = document.getElementById('vc-camera-device');
        // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
        const connection = peerConnection;
        if (!select || !connection || !navigator.mediaDevices?.enumerateDevices) return;
        // devices: Periferiche restituite dall’enumerazione del browser.
        // Gestisce il rifiuto della Promise secondo il recupero o la propagazione previsti nel blocco.
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
        if (connection !== peerConnection) return;
        // cameras: Videocamere disponibili con identificativo utilizzabile.
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: device (periferica corrente).
        const cameras = devices.filter(device => device.kind === 'videoinput' && device.deviceId);
        // currentId: Identificativo del dispositivo attualmente usato o selezionato.
        const currentId = localStream?.getVideoTracks()[0]?.getSettings().deviceId || select.value;
        // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
        // Riceve: device (periferica corrente); index (posizione nell’elenco).
        select.replaceChildren(...cameras.map((device, index) => (
            new Option(device.label || 'Videocamera ' + (index + 1), device.deviceId)
        )));
        // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
        // Riceve: device (periferica corrente).
        if (cameras.some(device => device.deviceId === currentId)) select.value = currentId;
        select.hidden = cameras.length === 0;
    },

    // _attivaVideocamera: Acquisisce la webcam scelta, sostituisce la traccia video e aggiorna anteprima e stato
    // remoto.
    // Riceve: deviceId (id della periferica scelta).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async _attivaVideocamera(deviceId) {
        // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
        const connection = peerConnection;
        // videoSender: Mittente RTP usato per sostituire la traccia video senza ricreare la connessione.
        const videoSender = this._getVideoTransceiver()?.sender;
        if (!connection?.remoteDescription || !videoSender || this.cameraRequest || this.isScreenSharePending) return;
        // cardLocale: Elemento DOM card-locale: Contenitore dell’interfaccia.
        const cardLocale = document.getElementById('card-locale');
        // acquiredStream: Flusso appena acquisito, da rilasciare se la richiesta non viene completata.
        let acquiredStream;
        this.cameraRequest = connection;
        this._syncCallControls();
        try {
            acquiredStream = await navigator.mediaDevices.getUserMedia({
                video: { ...cameraConstraints, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }
            });
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection) return;
            // track: Traccia multimediale corrente in fase di verifica o sostituzione.
            const [track] = acquiredStream.getVideoTracks();
            if (!track || track.readyState !== 'live') throw new Error('Traccia video assente');
            if (!this.isScreenSharing) {
                await videoSender.replaceTrack(track);
                await this._limitaInvioMedia(videoSender);
            }
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection) return;

            if (!localStream) {
                localStream = new MediaStream();
                this._setMediaStream('video-locale', localStream);
            }
            // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
            // previous: Riferimento precedente da ripristinare o verificare prima della sostituzione.
            for (const previous of localStream.getVideoTracks()) {
                previous.onended = null;
                previous.stop();
                localStream.removeTrack(previous);
            }
            localStream.addTrack(track);
            acquiredStream = null;
            // Gestisce la fine della traccia e ripristina lo stato multimediale.
            track.onended = () => {
                cardLocale?.classList.add('vc-video-off');
                this._emitRemoteVideoState(this.isScreenSharing);
                this._syncCallControls();
            };
            cardLocale?.classList.remove('vc-video-off');
            this._emitRemoteVideoState(true);
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
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

    // toggleVideo: Accende o spegne la webcam, acquisendo il dispositivo selezionato quando serve.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async toggleVideo() {
        // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
        if (!chiamataInCorso || !peerConnection?.remoteDescription || this.cameraRequest || this.isScreenSharePending) return;
        // selectedId: Valore letto dal campo HTML da validare o inviare.
        const selectedId = document.getElementById('vc-camera-device')?.value;
        // track: Traccia multimediale corrente in fase di verifica o sostituzione.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: candidate (candidato ICE).
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

    // condividiSchermo: Avvia o termina getDisplayMedia e sostituisce la traccia inviata, ripristinando poi la webcam.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    async condividiSchermo() {
        // connection: Connessione WebRTC da ricontrollare dopo le attese, per ignorare risultati di una chiamata chiusa.
        const connection = peerConnection;
        if (!chiamataInCorso || !connection?.remoteDescription || this.cameraRequest) return;

        // cardScreen: Elemento DOM card-screen: Contenitore dell’interfaccia.
        const cardScreen = document.getElementById('card-screen');
        // videoScreen: Elemento DOM video-screen: Riquadro video.
        const videoScreen = document.getElementById('video-screen');
        // imgScreen: Elemento DOM img-share-screen: Immagine dell’interfaccia.
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
            // streamDaChiudere: Valore della proprietà .screenStreamRef, conservato per le operazioni successive.
            const streamDaChiudere = this.screenStreamRef;
            this.isScreenSharing = false;
            this.isScreenSharePending = false;
            this.screenStreamRef = null;

            if (streamDaChiudere) {
                // Applica l’operazione del blocco a ciascun elemento della raccolta.
                // Riceve: track (traccia audio o video).
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
                // videoTransceiver: Canale WebRTC che associa invio e ricezione del video negoziato.
                const videoTransceiver = this._getVideoTransceiver();
                // videoTrack: Traccia video locale da abilitare, disabilitare o ripristinare.
                const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;

                if (videoTransceiver && videoTransceiver.sender) {
                    await videoTransceiver.sender.replaceTrack(videoTrack || null);
                }

                // isVideoOn: Indicatore booleano che controlla la condizione descritta dal nome.
                const isVideoOn = videoTrack ? videoTrack.enabled : false;
                this._emitRemoteVideoState(isVideoOn);
            }
            this.focusCard('card-remota');
            this._syncCallControls();
            return;
        }

        // screenStream: Riferimento o risultato da valorizzare durante l’operazione.
        let screenStream = null;
        this.isScreenSharePending = true;
        this._syncCallControls();

        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { ideal: 10, max: 15 } }
            });
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
            if (connection !== peerConnection) {
                this._stopMediaStream(screenStream);
                return;
            }
            // screenTrack: Traccia acquisita per condividere lo schermo.
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

            // videoTransceiver: Canale WebRTC che associa invio e ricezione del video negoziato.
            const videoTransceiver = this._getVideoTransceiver();
            if (videoTransceiver && videoTransceiver.sender) {
                await videoTransceiver.sender.replaceTrack(screenTrack);
                await this._limitaInvioMedia(videoTransceiver.sender);
            }

            this._emitRemoteVideoState(true);

            // Gestisce la fine della traccia e ripristina lo stato multimediale.
            // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
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
                
                // videoTrack: Traccia video locale da abilitare, disabilitare o ripristinare.
                const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;
                if (videoTransceiver && videoTransceiver.sender) {
                    await videoTransceiver.sender.replaceTrack(videoTrack || null);
                }

                // isVideoOn: Indicatore booleano che controlla la condizione descritta dal nome.
                const isVideoOn = videoTrack ? videoTrack.enabled : false;
                this._emitRemoteVideoState(isVideoOn);
                this.focusCard('card-remota');
                this._syncCallControls();
            };
            
        } catch (error) {
            // error: errore intercettato dal catch; il blocco decide come rispondere o propagarlo.
            this._stopMediaStream(screenStream);
            // Verifica che connessione o tentativo siano ancora quelli attivi prima di utilizzare il risultato.
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

// inizializzaControlliChiamata: Collega pulsanti, dispositivi e video ai rispettivi gestori dopo la preparazione
// del DOM.
function inizializzaControlliChiamata() {
    // handlers: Associa gli identificativi dei controlli alle funzioni che gestiscono i clic.
    const handlers = {
        // btn-accetta-chiamata: Collega il pulsante originale all’accettazione della chiamata in arrivo.
        'btn-accetta-chiamata': () => app.accettaChiamata(),
        // btn-rifiuta-chiamata: Collega il pulsante originale al rifiuto della chiamata in arrivo.
        'btn-rifiuta-chiamata': () => app.rifiutaChiamata(),
        // btn-toggle-audio: Collega il pulsante originale all’attivazione o disattivazione del microfono.
        'btn-toggle-audio': () => app.toggleAudio(),
        // btn-toggle-deafen: Collega il pulsante originale all’attivazione o disattivazione dell’ascolto.
        'btn-toggle-deafen': () => app.toggleDeafen(),
        // btn-riproduci-audio-remoto: Evita il clic sul riquadro sottostante e riprova la riproduzione dell’audio remoto.
        // Riceve: event (evento del browser).
        'btn-riproduci-audio-remoto': event => {
            event.stopPropagation();
            app._playRemoteAudio();
        },
        // btn-toggle-video: Collega il pulsante originale al cambio di stato della webcam.
        'btn-toggle-video': () => app.toggleVideo(),
        // btn-share-screen: Collega il pulsante originale all’avvio o alla fine della condivisione schermo.
        'btn-share-screen': () => app.condividiSchermo(),
        // btn-end-call: Collega il pulsante originale alla chiusura completa della chiamata.
        'btn-end-call': () => app.chiudiChiamata()
    };

    // Applica l’operazione del blocco a ciascun elemento della raccolta.
    // Riceve: id (identificativo dell’elemento); handler (funzione che gestisce l’azione).
    Object.entries(handlers).forEach(([id, handler]) => {
        document.getElementById(id)?.addEventListener('click', handler);
    });
    // remoteVideo: Elemento DOM video-remoto: Riquadro video.
    const remoteVideo = document.getElementById('video-remoto');
    // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
    // name: Riferimento o risultato da valorizzare durante l’operazione.
    for (const name of ['playing', 'loadeddata', 'resize', 'emptied']) {
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        remoteVideo?.addEventListener(name, () => app._syncRemoteVideo());
    }
    // cameraSelect: Elemento DOM vc-camera-device: Videocamera da usare.
    const cameraSelect = document.getElementById('vc-camera-device');
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    cameraSelect?.addEventListener('change', () => {
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: track (traccia audio o video).
        if (localStream?.getVideoTracks().some(track => track.enabled && track.readyState === 'live')) {
            app._attivaVideocamera(cameraSelect.value);
        }
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    navigator.mediaDevices?.addEventListener('devicechange', () => {
        if (cameraSelect && !cameraSelect.hidden) app.aggiornaElencoVideocamere();
        window.callView?.refreshDevices();
    });

    // Applica l’operazione del blocco a ciascun elemento della raccolta.
    // Riceve: card (riquadro corrente).
    document.querySelectorAll('[data-focus-card]').forEach(card => {
        // Esegue l’azione del controllo quando viene premuto. Sposta il riquadro scelto nell’area principale e riporta il
        // precedente nella colonna laterale.
        card.addEventListener('click', () => app.focusCard(card.dataset.focusCard));
    });

    app._syncCallControls();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inizializzaControlliChiamata, { once: true });
} else {
    inizializzaControlliChiamata();
}
