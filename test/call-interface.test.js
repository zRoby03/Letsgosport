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

// interfaceContext: Prepara un DOM minimo simulato per verificare la vista della chiamata senza browser reale.
function interfaceContext() {
    // elements: Elementi indicizzati usati dalla vista o dal DOM simulato del test.
    const elements = new Map();
    // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
    // id: Riferimento o risultato da valorizzare durante l’operazione.
    for (const id of ['modale-videochiamata', 'vc-network-path', 'vc-network-latency', 'vc-connection-status', 'vc-call-duration']) {
        elements.set(id, { dataset: {}, textContent: '' });
    }
    // cleared: Indica se il test ha osservato la cancellazione dell’intervallo.
    let cleared = false;
    // window: Oggetto che raccoglie i dati e le opzioni utilizzati nel blocco.
    // setInterval: Simula la registrazione di un intervallo e restituisce l’identificativo controllato dal test.
    // clearInterval: Registra nel test la richiesta di cancellazione dell’intervallo simulato.
    // Riceve: id (identificativo dell’elemento).
    const window = { app: {}, setInterval: () => 42, clearInterval: id => { cleared = id === 42; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/call-interface.js'), 'utf8'), {
        window, Date,
        navigator: { mediaDevices: {} },
        // addEventListener: Simula il metodo addEventListener senza eseguire operazioni reali.
        // getElementById: Restituisce l’elemento del DOM simulato associato all’id richiesto.
        // Riceve: id (identificativo dell’elemento).
        document: { readyState: 'loading', addEventListener() {}, getElementById: id => elements.get(id) }
    });
    // wasCleared: Restituisce se il test ha osservato la cancellazione dell’intervallo.
    return { ui: window.callView, elements, wasCleared: () => cleared };
}

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
test('il percorso TURN deriva dalla coppia selezionata e ignora i relay non utilizzati', () => {
    // ui: Risultato di interfaceContext. Prepara un DOM minimo simulato per verificare la vista della chiamata senza
    // browser reale.
    const { ui } = interfaceContext();
    // report: Statistiche o resoconto che raccolgono l’esito dell’elaborazione.
    const report = new Map([
        ['transport', { type: 'transport', selectedCandidatePairId: 'direct-pair' }],
        ['unused-relay', { type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'relay' }],
        ['direct-pair', { type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local', remoteCandidateId: 'remote', currentRoundTripTime: 0.042 }],
        ['local', { candidateType: 'host' }],
        ['remote', { candidateType: 'srflx' }],
        ['relay', { candidateType: 'relay' }]
    ]);
    assert.equal(ui.connectionInfo(report).path, 'direct');
    assert.equal(ui.connectionInfo(report).latency, 42);
    report.get('direct-pair').remoteCandidateId = 'relay';
    assert.equal(ui.connectionInfo(report).path, 'turn');
    assert.equal(ui.connectionInfo(new Map()).path, null);
    report.get('direct-pair').currentRoundTripTime = undefined;
    assert.equal(ui.connectionInfo(report).latency, null);
});

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
test('la chiusura ferma il monitoraggio e ignora le statistiche ancora in arrivo', async () => {
    // ui: Risultato di interfaceContext. Prepara un DOM minimo simulato per verificare la vista della chiamata senza
    // browser reale.
    // elements: Elementi indicizzati usati dalla vista o dal DOM simulato del test.
    // wasCleared: Risultato di interfaceContext. Prepara un DOM minimo simulato per verificare la vista della chiamata
    // senza browser reale.
    const { ui, elements, wasCleared } = interfaceContext();
    // resolveStats: Funzione con cui il test consegna statistiche simulate rimaste in attesa.
    let resolveStats;
    // connection: Connessione acquisita per mantenere coerenti le operazioni del blocco.
    const connection = {
        iceConnectionState: 'connected',
        // getStats: Fornisce le statistiche simulate o la Promise controllata necessaria al test della connessione.
        // Collega l’operazione a resolve e reject, che completano la Promise con successo o errore.
        // Riceve: resolve (completa la Promise con successo).
        getStats: () => new Promise(resolve => { resolveStats = resolve; })
    };
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    ui.open(() => ({ connection, startedAt: Date.now(), micOn: true }));
    assert.equal(elements.get('vc-network-path').textContent, 'Collegamento attivo');
    ui.close();
    assert.equal(wasCleared(), true);
    elements.get('vc-network-path').textContent = 'Chiamata chiusa';
    resolveStats(new Map([
        ['pair', { type: 'candidate-pair', state: 'succeeded', selected: true, localCandidateId: 'relay' }],
        ['relay', { candidateType: 'relay' }]
    ]));
    await Promise.resolve();
    assert.equal(elements.get('vc-network-path').textContent, 'Chiamata chiusa');
});
