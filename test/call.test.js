const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function callContext() {
    const app = {};
    const window = { app, socket: { on() {} } };
    class MediaStream {
        constructor(tracks = []) { this.tracks = [...tracks]; }
        addTrack(track) { this.tracks.push(track); }
        getTracks() { return this.tracks; }
        getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
        removeTrack(track) { this.tracks = this.tracks.filter(item => item !== track); }
    }
    const context = vm.createContext({
        window, app, MediaStream,
        document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
        navigator: { mediaDevices: {} },
        console: { warn() {}, error() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/call.js'), 'utf8'), context);
    return context;
}

test('il profilo di risparmio limita bitrate audio/video senza interrompere browser incompatibili', async () => {
    const { app } = callContext();
    for (const kind of ['video', 'audio']) {
        let applied;
        await app._limitaInvioMedia({
            track: { kind },
            getParameters: () => ({ encodings: [{ active: true }] }),
            setParameters: async parameters => { applied = parameters; }
        });
        assert.equal(applied.encodings[0].maxBitrate, kind === 'video' ? 500000 : 32000);
        assert.equal(applied.encodings[0].active, true);
        assert.equal(applied.encodings[0].maxFramerate, kind === 'video' ? 15 : undefined);
    }
    await app._limitaInvioMedia({ track: { kind: 'video' }, getParameters: () => ({ encodings: [] }),
        setParameters: async () => assert.fail('Non aggiungere codifiche prima della negoziazione') });
    await app._limitaInvioMedia({ track: { kind: 'video' }, getParameters: () => ({ encodings: [{}] }),
        setParameters: async () => { throw new Error('Unsupported'); } });
});

test('la scelta della webcam mantiene il dispositivo e acquisisce al massimo 480p e 15 fps', async () => {
    const context = callContext();
    const { app } = context;
    const track = { kind: 'video', readyState: 'live', stop() {} };
    let requested;
    let sent;
    const sender = {
        getParameters: () => ({ encodings: [{}] }), setParameters: async () => {},
        replaceTrack: async value => { sender.track = value; sent = value; }
    };
    context.navigator.mediaDevices.getUserMedia = async constraints => {
        requested = constraints;
        return new context.MediaStream([track]);
    };
    context.testConnection = { remoteDescription: {} };
    vm.runInContext('peerConnection = testConnection', context);
    app._getVideoTransceiver = () => ({ sender });
    app._syncCallControls = () => {};
    app._emitRemoteVideoState = () => {};
    app._setMediaStream = () => {};
    app.aggiornaElencoVideocamere = async () => {};
    await app._attivaVideocamera('selected-camera');
    assert.equal(sent, track);
    assert.equal(requested.video.deviceId.exact, 'selected-camera');
    assert.equal(requested.video.width.max, 640);
    assert.equal(requested.video.height.max, 480);
    assert.equal(requested.video.frameRate.max, 15);
});

test('ICE consente il collegamento diretto e applica i limiti dopo la negoziazione', async () => {
    const context = callContext();
    let config;
    let limits = 0;
    context.RTCPeerConnection = class {
        constructor(value) { config = value; this.signalingState = 'stable'; }
        getSenders() { return [{ track: { kind: 'video' } }]; }
    };
    context.app._limitaInvioMedia = async () => { limits++; };
    const servers = [{ urls: 'turn:relay.example:3478' }];
    const connection = context.app._creaMotoreWebRTC(servers);
    assert.equal(config.iceTransportPolicy, 'all');
    assert.equal(config.iceServers, servers);
    connection.onsignalingstatechange();
    assert.equal(limits, 1);
});
