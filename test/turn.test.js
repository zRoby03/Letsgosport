// Test automatici Node.js: prepara dati o servizi di prova e verifica gli esiti tramite asserzioni.
// Mock e contesti isolati sostituiscono le risorse previste dalla prova; le pulizie registrate ripristinano lo
// stato al termine.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// assert: Le asserzioni fanno fallire il test quando risultato ed esito atteso non coincidono.
const assert = require('node:assert/strict');
// createHmac: Costruisce una firma autenticata mediante un segreto condiviso.
const { createHmac } = require('node:crypto');
// test: Il test runner integrato di Node.js registra prove, simulazioni e pulizie a fine test.
const { test } = require('node:test');
// axios: Axios invia richieste HTTP ai servizi esterni e supporta timeout ed errori di risposta.
const axios = require('axios');
// getIceServers: Restituisce server ICE con credenziali temporanee dopo i controlli su configurazione ed email
// autorizzate.
const { getIceServers } = require('../config/turn');

// names: Elenco dei valori che questo blocco deve confrontare, mostrare o elaborare.
const names = ['TURN_ENABLED', 'TURN_KEY_ID', 'TURN_KEY_API_TOKEN', 'TURN_URLS',
    'TURN_SHARED_SECRET', 'TURN_ALLOWED_EMAILS', 'TURN_TTL_SECONDS'];
// user: Dati dell’utente coinvolto in questo blocco.
const user = { id: 12, email: 'tester@example.test' };
// keyId: Identificativo della chiave TURN configurata sul provider.
const keyId = '0123456789abcdef0123456789abcdef';
// temporary: Elenco dei valori che questo blocco deve confrontare, mostrare o elaborare.
const temporary = [{ urls: ['turn:turn.cloudflare.com:3478?transport=udp',
    'turns:turn.cloudflare.com:443?transport=tcp'], username: 'temporary-user', credential: 'temporary-password' }];

// configure: Imposta temporaneamente le variabili TURN del test e registra il ripristino a fine prova.
// Riceve: t (contesto del test Node.js); values (valori da elaborare).
function configure(t, values = {}) {
    // previous: Riferimento precedente da ripristinare o verificare prima della sostituzione.
    // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
    // Riceve: name (nome da utilizzare).
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
    // name: Riferimento o risultato da valorizzare durante l’operazione.
    for (const name of names) delete process.env[name];
    // Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
    Object.assign(process.env, values);
    // Ripristina ambiente e risorse al termine del test, anche in caso di fallimento.
    t.after(() => {
        // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
        // name: Riferimento o risultato da valorizzare durante l’operazione.
        for (const name of names) {
            if (previous[name] === undefined) delete process.env[name];
            else process.env[name] = previous[name];
        }
    });
}

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// Riceve: t (contesto del test Node.js).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('senza TURN configurato rimane disponibile la connessione diretta', async t => {
    configure(t);
    assert.deepEqual(await getIceServers(user), []);
});

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// Riceve: t (contesto del test Node.js).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('Cloudflare restituisce solo credenziali temporanee e usa un timeout limitato', async t => {
    configure(t, { TURN_KEY_ID: keyId, TURN_KEY_API_TOKEN: 'private-api-token', TURN_TTL_SECONDS: '3600' });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: url (indirizzo della risorsa o del servizio); body (dati ricevuti dal form); options (opzioni che
    // controllano l’operazione).
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    t.mock.method(axios, 'post', async (url, body, options) => {
        assert.equal(url, 'https://rtc.live.cloudflare.com/v1/turn/keys/' + keyId + '/credentials/generate-ice-servers');
        assert.deepEqual(body, { ttl: 3600 });
        assert.equal(options.headers.Authorization, 'Bearer private-api-token');
        assert.equal(options.timeout, 3500);
        assert.equal(options.maxRedirects, 0);
        // iceServers: Server STUN/TURN usati dal browser per trovare i percorsi di rete della chiamata.
        return { data: { iceServers: [{ ...temporary[0], privateToken: 'private-api-token' }] } };
    });
    // result: Risultato dell’operazione asincrona, disponibile dopo il completamento della Promise.
    const result = await getIceServers(user);
    assert.deepEqual(result, temporary);
    assert.ok(!JSON.stringify(result).includes('private-api-token'));
});

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// Riceve: t (contesto del test Node.js).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('la lista degli account ammessi e lo spegnimento impediscono nuove credenziali', async t => {
    configure(t, { TURN_KEY_ID: keyId, TURN_KEY_API_TOKEN: 'private-api-token', TURN_ALLOWED_EMAILS: 'other@example.test' });
    // post: Risultato della chiamata t.mock.method, riutilizzato nelle istruzioni successive.
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    // iceServers: Server STUN/TURN usati dal browser per trovare i percorsi di rete della chiamata.
    const post = t.mock.method(axios, 'post', async () => ({ data: { iceServers: temporary } }));
    await assert.rejects(getIceServers(user), { code: 'TURN_USER_NOT_ALLOWED', status: 403 });
    assert.equal(post.mock.callCount(), 0);
    process.env.TURN_ALLOWED_EMAILS = ' TESTER@EXAMPLE.TEST ';
    assert.deepEqual(await getIceServers(user), temporary);
    process.env.TURN_ENABLED = 'false';
    assert.deepEqual(await getIceServers(user), []);
    assert.equal(post.mock.callCount(), 1);
});

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// Riceve: t (contesto del test Node.js).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('errori e risposte non valide del provider non espongono il token', async t => {
    configure(t, { TURN_KEY_ID: keyId, TURN_KEY_API_TOKEN: 'private-api-token' });
    // post: Risultato della chiamata t.mock.method, riutilizzato nelle istruzioni successive.
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    const post = t.mock.method(axios, 'post', async () => {
        throw new Error('Authorization: Bearer private-api-token');
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: error (errore intercettato).
    await assert.rejects(getIceServers(user), error => error.code === 'TURN_PROVIDER_UNAVAILABLE' &&
        !String(error).includes('private-api-token') && !error.cause);
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    // iceServers: Server STUN/TURN usati dal browser per trovare i percorsi di rete della chiamata.
    post.mock.mockImplementation(async () => ({ data: { iceServers: [{ urls: ['https://invalid.example'] }] } }));
    await assert.rejects(getIceServers(user), { code: 'TURN_INVALID_RESPONSE' });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    // iceServers: Server STUN/TURN usati dal browser per trovare i percorsi di rete della chiamata.
    post.mock.mockImplementation(async () => ({ data: { iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'] }] } }));
    await assert.rejects(getIceServers(user), { code: 'TURN_INVALID_RESPONSE' });
    process.env.TURN_KEY_ID = '../invalid-key';
    await assert.rejects(getIceServers(user), { code: 'TURN_INVALID_CONFIGURATION' });
});

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// Riceve: t (contesto del test Node.js).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('coturn continua a usare la firma HMAC con scadenza', async t => {
    configure(t, { TURN_URLS: ' turn:relay.example:3478?transport=udp, turns:relay.example:443?transport=tcp ',
        TURN_SHARED_SECRET: 'coturn-private-secret', TURN_TTL_SECONDS: '1800' });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    t.mock.method(Date, 'now', () => 1800000000000);
    // username: Nome utente delle credenziali temporanee generato o ricevuto dal provider.
    const username = '1800001800:12';
    assert.deepEqual(await getIceServers(user), [{
        urls: ['turn:relay.example:3478?transport=udp', 'turns:relay.example:443?transport=tcp'],
        username, credential: createHmac('sha1', 'coturn-private-secret').update(username).digest('base64')
    }]);
    process.env.TURN_TTL_SECONDS = '0';
    await assert.rejects(getIceServers(user), { code: 'TURN_INVALID_TTL' });
});
