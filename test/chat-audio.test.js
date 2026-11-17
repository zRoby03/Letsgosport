// Verifica la registrazione con permessi asincroni e il corretto destinatario del vocale.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function recordingContext(getUserMedia) {
    const elements = new Map();
    for (const id of ['stato-registrazione-vocale', 'btn-registra-vocale', 'btn-annulla-vocale',
        'etichetta-registrazione-vocale', 'suggerimento-registrazione-vocale', 'tempo-registrazione-vocale', 'composer']) {
        const classes = new Set();
        elements.set(id, {
            hidden: true, dataset: {}, textContent: '', attributes: {},
            classList: { toggle: (name, active) => active ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) },
            setAttribute(name, value) { this.attributes[name] = value; }
        });
    }
    const intervals = new Map();
    const sent = [];
    const notices = [];
    let intervalId = 0;
    let now = 10000;
    class Clock extends Date { static now() { return now; } }
    class Recorder {
        constructor(stream) { this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/webm'; }
        start() { this.state = 'recording'; }
        stop() {
            this.state = 'inactive';
            this.ondataavailable({ data: new Blob(['audio registrato'], { type: this.mimeType }) });
            this.finished = Promise.resolve(this.onstop());
        }
    }
    const app = { aggiornaComposerChat() {}, mostraNotifica: (...args) => notices.push(args) };
    const window = {
        app, stanzaAttuale: 'private_1_2',
        setInterval(callback) { intervals.set(++intervalId, callback); return intervalId; },
        clearInterval(id) { intervals.delete(id); }
    };
    const socket = { connected: true, emit: (event, data) => sent.push({ event, data }) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/chat-audio.js'), 'utf8'), {
        window, app, socket, Date: Clock, Blob, FormData, MediaRecorder: Recorder,
        navigator: { mediaDevices: { getUserMedia } },
        document: { getElementById: id => elements.get(id), querySelector: () => elements.get('composer') }
    });
    return { app, window, socket, elements, intervals, sent, notices, Recorder, advance(ms) {
        now += ms;
        for (const callback of intervals.values()) callback();
    } };
}

function microphone() {
    const track = { stopped: false, stop() { this.stopped = true; } };
    return { track, getTracks: () => [track] };
}

test('un rilascio durante la richiesta del microfono impedisce una registrazione tardiva', async () => {
    let grant;
    let requests = 0;
    const ctx = recordingContext(() => { requests++; return new Promise(resolve => { grant = resolve; }); });
    const pending = ctx.app.iniziaRegistrazioneVocale();
    await ctx.app.iniziaRegistrazioneVocale();
    assert.equal(requests, 1);
    assert.equal(ctx.elements.get('stato-registrazione-vocale').dataset.state, 'pending');
    ctx.app.fermaRegistrazioneVocale();
    const stream = microphone();
    grant(stream);
    await pending;
    assert.equal(stream.track.stopped, true);
    assert.equal(ctx.app.staRegistrando, false);
    assert.equal(ctx.app.registrazioneVocale, null);
    assert.equal(ctx.elements.get('stato-registrazione-vocale').hidden, true);
    assert.equal(ctx.sent.length, 0);
});

test('registrazione, timer e invio mostrano lo stato e rilasciano il microfono', async () => {
    const stream = microphone();
    const ctx = recordingContext(async () => stream);
    let finishUpload;
    ctx.app.apiRequest = () => new Promise(resolve => { finishUpload = resolve; });
    await ctx.app.iniziaRegistrazioneVocale();
    assert.equal(ctx.app.staRegistrando, true);
    assert.equal(ctx.elements.get('stato-registrazione-vocale').dataset.state, 'recording');
    assert.equal(ctx.elements.get('btn-registra-vocale').attributes['aria-pressed'], 'true');
    ctx.advance(65000);
    assert.equal(ctx.elements.get('tempo-registrazione-vocale').textContent, '1:05');
    const recorder = ctx.app.mediaRecorder;
    ctx.app.fermaRegistrazioneVocale();
    assert.equal(stream.track.stopped, true);
    assert.equal(ctx.intervals.size, 0);
    assert.equal(ctx.elements.get('stato-registrazione-vocale').dataset.state, 'sending');
    assert.equal(ctx.elements.get('btn-annulla-vocale').hidden, true);
    finishUpload({ file_url: '/media/vocale', file_type: 'audio', upload_token: 'test-upload' });
    await recorder.finished;
    assert.equal(ctx.sent[0].data.room, 'private_1_2');
    assert.equal(ctx.app.registrazioneVocale, null);
    assert.equal(ctx.elements.get('stato-registrazione-vocale').hidden, true);
});

test('annullamento e cambio stanza scartano il vocale senza inviarlo', async t => {
    for (const changeRoom of [false, true]) await t.test(changeRoom ? 'cambio stanza' : 'annullamento', async () => {
        const stream = microphone();
        const ctx = recordingContext(async () => stream);
        let uploads = 0;
        ctx.app.apiRequest = async () => { uploads++; };
        await ctx.app.iniziaRegistrazioneVocale();
        const recorder = ctx.app.mediaRecorder;
        if (changeRoom) ctx.window.stanzaAttuale = 'private_1_3';
        ctx.app.fermaRegistrazioneVocale(!changeRoom);
        await recorder.finished;
        assert.equal(uploads, 0);
        assert.equal(ctx.sent.length, 0);
        assert.equal(stream.track.stopped, true);
        assert.equal(ctx.intervals.size, 0);
    });
});

test('il vocale già in caricamento mantiene la stanza iniziale', async () => {
    const ctx = recordingContext(async () => microphone());
    let finishUpload;
    let requestedUrl;
    ctx.app.apiRequest = url => { requestedUrl = url; return new Promise(resolve => { finishUpload = resolve; }); };
    await ctx.app.iniziaRegistrazioneVocale();
    const recorder = ctx.app.mediaRecorder;
    ctx.app.fermaRegistrazioneVocale();
    ctx.window.stanzaAttuale = 'private_1_3';
    finishUpload({ file_url: '/media/vocale', file_type: 'audio', upload_token: 'test-upload' });
    await recorder.finished;
    assert.equal(requestedUrl, '/api/chat/upload?room=private_1_2');
    assert.equal(ctx.sent[0].data.room, 'private_1_2');
});

test('permessi negati e avvio fallito ripristinano i controlli e le tracce', async t => {
    await t.test('permesso negato', async () => {
        const ctx = recordingContext(async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); });
        await ctx.app.iniziaRegistrazioneVocale();
        assert.equal(ctx.app.registrazioneVocale, null);
        assert.equal(ctx.elements.get('stato-registrazione-vocale').hidden, true);
        assert.match(ctx.notices[0][0], /Permesso/);
    });
    await t.test('errore del registratore', async () => {
        const stream = microphone();
        const ctx = recordingContext(async () => stream);
        ctx.Recorder.prototype.start = () => { throw new Error('Registratore non disponibile'); };
        await ctx.app.iniziaRegistrazioneVocale();
        assert.equal(stream.track.stopped, true);
        assert.equal(ctx.app.registrazioneVocale, null);
        assert.equal(ctx.intervals.size, 0);
    });
});
