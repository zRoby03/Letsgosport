// Test automatici Node.js: prepara dati o servizi di prova e verifica gli esiti tramite asserzioni.
// Mock e contesti isolati sostituiscono le risorse previste dalla prova; le pulizie registrate ripristinano lo
// stato al termine.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// assert: Le asserzioni fanno fallire il test quando risultato ed esito atteso non coincidono.
const assert = require('node:assert/strict');
// fs: Le API del filesystem leggono, scrivono e controllano i file sul disco.
const fs = require('node:fs');
// path: path costruisce e verifica percorsi con i separatori corretti del sistema operativo.
const path = require('node:path');
// test: Il test runner integrato di Node.js registra prove, simulazioni e pulizie a fine test.
const { test } = require('node:test');
// vm: vm esegue il frontend in un contesto isolato con browser e dispositivi simulati.
const vm = require('node:vm');

// callContext: Crea nel test un ambiente JavaScript isolato con oggetti browser simulati.
function callContext() {
    // app: Oggetto applicativo simulato usato dal test.
    const app = {};
    // window: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
    // on: Simula il metodo on senza eseguire operazioni reali.
    const window = { app, socket: { on() {} } };
    // MediaStream: raggruppa stato e metodi del registro; ogni istanza mantiene i propri dati.
    class MediaStream {
        // constructor: Simula constructor sul flusso multimediale del test, senza usare periferiche reali.
        // Riceve: tracks (tracce iniziali del flusso).
        // function Object() { [native code] }
        constructor(tracks = []) { this.tracks = [...tracks]; }
        // addTrack: Simula addTrack sul flusso multimediale del test, senza usare periferiche reali.
        // Riceve: track (traccia audio o video).
        addTrack(track) { this.tracks.push(track); }
        // getTracks: Simula getTracks sul flusso multimediale del test, senza usare periferiche reali.
        getTracks() { return this.tracks; }
        // getVideoTracks: Simula getVideoTracks sul flusso multimediale del test, senza usare periferiche reali.
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: track (traccia audio o video).
        getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
        // getAudioTracks: Simula getAudioTracks sul flusso multimediale del test, senza usare periferiche reali.
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: track (traccia audio o video).
        getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
        // removeTrack: Simula removeTrack sul flusso multimediale del test, senza usare periferiche reali.
        // Riceve: track (traccia audio o video).
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: item (elemento corrente).
        removeTrack(track) { this.tracks = this.tracks.filter(item => item !== track); }
    }
    // context: Ambiente JavaScript isolato o contesto di lavoro preparato dal blocco.
    const context = vm.createContext({
        window, app, MediaStream,
        // addEventListener: Simula il metodo addEventListener senza eseguire operazioni reali.
        // getElementById: Restituisce l’elemento del DOM simulato associato all’id richiesto.
        document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
        navigator: { mediaDevices: {} },
        // warn: Simula il metodo warn senza eseguire operazioni reali.
        // error: Simula il metodo error senza eseguire operazioni reali.
        console: { warn() {}, error() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/call.js'), 'utf8'), context);
    return context;
}

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('il profilo di risparmio limita bitrate audio/video senza interrompere browser incompatibili', async () => {
    // app: Oggetto applicativo simulato usato dal test.
    const { app } = callContext();
    // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
    // kind: Riferimento o risultato da valorizzare durante l’operazione.
    for (const kind of ['video', 'audio']) {
        // applied: Parametri osservati dal test dopo l’applicazione al mittente.
        let applied;
        await app._limitaInvioMedia({
            track: { kind },
            // getParameters: Restituisce i parametri RTP simulati da modificare o confrontare nella prova.
            getParameters: () => ({ encodings: [{ active: true }] }),
            // setParameters: Registra o verifica i parametri RTP applicati al mittente simulato.
            // Riceve: parameters (parametri RTP da applicare).
            // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
            setParameters: async parameters => { applied = parameters; }
        });
        assert.equal(applied.encodings[0].maxBitrate, kind === 'video' ? 500000 : 32000);
        assert.equal(applied.encodings[0].active, true);
        assert.equal(applied.encodings[0].maxFramerate, kind === 'video' ? 15 : undefined);
    }
    // getParameters: Restituisce i parametri RTP simulati da modificare o confrontare nella prova.
    await app._limitaInvioMedia({ track: { kind: 'video' }, getParameters: () => ({ encodings: [] }),
        // setParameters: Registra o verifica i parametri RTP applicati al mittente simulato.
        // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
        setParameters: async () => assert.fail('Non aggiungere codifiche prima della negoziazione') });
    // getParameters: Restituisce i parametri RTP simulati da modificare o confrontare nella prova.
    await app._limitaInvioMedia({ track: { kind: 'video' }, getParameters: () => ({ encodings: [{}] }),
        // setParameters: Registra o verifica i parametri RTP applicati al mittente simulato.
        // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
        setParameters: async () => { throw new Error('Unsupported'); } });
});

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('la scelta della webcam mantiene il dispositivo e acquisisce al massimo 480p e 15 fps', async () => {
    // context: Ambiente JavaScript isolato o contesto di lavoro preparato dal blocco.
    const context = callContext();
    // app: Oggetto applicativo simulato usato dal test.
    const { app } = context;
    // track: Traccia multimediale corrente in fase di verifica o sostituzione.
    // stop: Simula il metodo stop senza eseguire operazioni reali.
    const track = { kind: 'video', readyState: 'live', stop() {} };
    // requested: Valore catturato dal test per verificare i parametri inviati.
    let requested;
    // sent: Traccia o dato osservato dal test dopo l’invio.
    let sent;
    // sender: Mittente RTP che trasporta la traccia verso l’altro partecipante.
    const sender = {
        // getParameters: Restituisce i parametri RTP simulati da modificare o confrontare nella prova.
        // setParameters: Simula il metodo setParameters senza eseguire operazioni reali.
        // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
        getParameters: () => ({ encodings: [{}] }), setParameters: async () => {},
        // replaceTrack: Sostituisce la traccia del mittente simulato per verificare il cambio di periferica.
        // Riceve: value (valore da elaborare).
        // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
        replaceTrack: async value => { sender.track = value; sent = value; }
    };
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: constraints (vincoli di acquisizione multimediale).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    context.navigator.mediaDevices.getUserMedia = async constraints => {
        requested = constraints;
        return new context.MediaStream([track]);
    };
    context.testConnection = { remoteDescription: {} };
    vm.runInContext('peerConnection = testConnection', context);
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    app._getVideoTransceiver = () => ({ sender });
    // Simula il metodo del browser senza eseguire operazioni reali.
    app._syncCallControls = () => {};
    // Simula il metodo del browser senza eseguire operazioni reali.
    app._emitRemoteVideoState = () => {};
    // Simula il metodo del browser senza eseguire operazioni reali.
    app._setMediaStream = () => {};
    // Simula il metodo del browser senza eseguire operazioni reali.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    app.aggiornaElencoVideocamere = async () => {};
    await app._attivaVideocamera('selected-camera');
    assert.equal(sent, track);
    assert.equal(requested.video.deviceId.exact, 'selected-camera');
    assert.equal(requested.video.width.max, 640);
    assert.equal(requested.video.height.max, 480);
    assert.equal(requested.video.frameRate.max, 15);
});

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('ICE consente il collegamento diretto e applica i limiti dopo la negoziazione', async () => {
    // context: Ambiente JavaScript isolato o contesto di lavoro preparato dal blocco.
    const context = callContext();
    // config: Riferimento o risultato da valorizzare durante l’operazione.
    let config;
    // limits: Dimensione o limite numerico usato nella verifica.
    let limits = 0;
    context.RTCPeerConnection = class {
        // constructor: Simula constructor sul flusso multimediale del test, senza usare periferiche reali.
        // Riceve: value (valore da elaborare).
        // function Object() { [native code] }
        constructor(value) { config = value; this.signalingState = 'stable'; }
        // getSenders: Restituisce i mittenti RTP simulati usati dalla prova.
        getSenders() { return [{ track: { kind: 'video' } }]; }
    };
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    context.app._limitaInvioMedia = async () => { limits++; };
    // servers: Elenco dei server ICE validati da restituire al browser.
    const servers = [{ urls: 'turn:relay.example:3478' }];
    // connection: Connessione acquisita per mantenere coerenti le operazioni del blocco.
    const connection = context.app._creaMotoreWebRTC(servers);
    assert.equal(config.iceTransportPolicy, 'all');
    assert.equal(config.iceServers, servers);
    connection.onsignalingstatechange();
    assert.equal(limits, 1);
});

// microphoneContext: Prepara una connessione simulata con un microfono già presente per provarne la sostituzione.
function microphoneContext() {
    // context: Ambiente JavaScript isolato o contesto di lavoro preparato dal blocco.
    const context = callContext();
    // oldTrack: Traccia precedente conservata dal test per verificare la sostituzione.
    const oldTrack = { kind: 'audio', readyState: 'live', enabled: false, stopped: false,
        // stop: Ferma la risorsa simulata o di prova secondo l’implementazione del test.
        stop() { this.stopped = true; } };
    // sender: Mittente RTP che trasporta la traccia verso l’altro partecipante.
    // replaceTrack: Sostituisce la traccia del mittente simulato per verificare il cambio di periferica.
    // Riceve: track (traccia audio o video).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    const sender = { track: oldTrack, replaceTrack: async track => { sender.track = track; } };
    context.testConnection = { remoteDescription: {},
        // getTransceivers: Restituisce i canali audio o video simulati usati dalla prova.
        getTransceivers: () => [{ sender, direction: 'sendrecv', currentDirection: 'sendrecv' }] };
    context.oldStream = new context.MediaStream([oldTrack]);
    vm.runInContext('peerConnection = testConnection; localStream = oldStream;', context);
    // Simula il metodo del browser senza eseguire operazioni reali.
    context.app._syncCallControls = () => {};
    // Simula il metodo del browser senza eseguire operazioni reali.
    context.app._emitAudioState = () => {};
    // Simula il metodo del browser senza eseguire operazioni reali.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    context.app._limitaInvioMedia = async () => {};
    return { context, sender, oldTrack };
}

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('il cambio microfono conserva il mute e sostituisce la traccia solo dopo l’acquisizione', async () => {
    // context: Ambiente JavaScript isolato o contesto di lavoro preparato dal blocco.
    // sender: Mittente RTP che trasporta la traccia verso l’altro partecipante.
    // oldTrack: Traccia precedente conservata dal test per verificare la sostituzione.
    const { context, sender, oldTrack } = microphoneContext();
    // newTrack: Traccia simulata che deve sostituire quella precedente.
    // stop: Simula il metodo stop senza eseguire operazioni reali.
    const newTrack = { kind: 'audio', readyState: 'live', enabled: true, stop() {} };
    // constraints: Vincoli passati alla richiesta di acquisizione audio o video.
    let constraints;
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: value (valore da elaborare).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    context.navigator.mediaDevices.getUserMedia = async value => {
        constraints = value;
        return new context.MediaStream([newTrack]);
    };
    await context.app.cambiaMicrofonoChiamata('second-microphone');
    assert.equal(constraints.audio.deviceId.exact, 'second-microphone');
    assert.equal(constraints.audio.echoCancellation, true);
    assert.equal(sender.track, newTrack);
    assert.equal(newTrack.enabled, false);
    assert.equal(oldTrack.stopped, true);
    assert.equal(context.app.microphoneRequest, null);
});

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('un errore di acquisizione mantiene il microfono precedente', async () => {
    // context: Ambiente JavaScript isolato o contesto di lavoro preparato dal blocco.
    // sender: Mittente RTP che trasporta la traccia verso l’altro partecipante.
    // oldTrack: Traccia precedente conservata dal test per verificare la sostituzione.
    const { context, sender, oldTrack } = microphoneContext();
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    context.navigator.mediaDevices.getUserMedia = async () => { throw new Error('Permission denied'); };
    await context.app.cambiaMicrofonoChiamata('unavailable');
    assert.equal(sender.track, oldTrack);
    assert.equal(oldTrack.stopped, false);
    assert.equal(context.app.microphoneRequest, null);
});

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('il microfono acquisito dopo la chiusura viene rilasciato senza modificare la vecchia connessione', async () => {
    // context: Ambiente JavaScript isolato o contesto di lavoro preparato dal blocco.
    // sender: Mittente RTP che trasporta la traccia verso l’altro partecipante.
    // oldTrack: Traccia precedente conservata dal test per verificare la sostituzione.
    const { context, sender, oldTrack } = microphoneContext();
    // resolveCapture: Funzione con cui il test completa una richiesta di acquisizione rimasta in attesa.
    let resolveCapture;
    // released: Indica se il test ha osservato il rilascio della risorsa.
    let released = false;
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
    // Riceve: resolve (completa la Promise con successo).
    context.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolveCapture = resolve; });
    // pending: Prenotazioni non ancora riconciliate con gli oggetti presenti nello storage.
    const pending = context.app.cambiaMicrofonoChiamata('late-microphone');
    vm.runInContext('peerConnection = null;', context);
    // stop: Ferma la risorsa simulata o di prova secondo l’implementazione del test.
    resolveCapture(new context.MediaStream([{ kind: 'audio', stop() { released = true; } }]));
    await pending;
    assert.equal(released, true);
    assert.equal(sender.track, oldTrack);
});
