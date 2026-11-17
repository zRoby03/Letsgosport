// Test automatici Node.js: prepara dati o servizi di prova e verifica gli esiti tramite asserzioni.
// Mock e contesti isolati sostituiscono le risorse previste dalla prova; le pulizie registrate ripristinano lo
// stato al termine.
// assert: Le asserzioni fanno fallire il test quando risultato ed esito atteso non coincidono.
const assert = require('node:assert/strict');
// test: Il test runner integrato di Node.js registra prove, simulazioni e pulizie a fine test.
const { test } = require('node:test');
// getStorageLimitBytes: Restituisce il limite di spazio in byte e rifiuta configurazioni che non sono interi
// positivi sicuri.
const { getStorageLimitBytes } = require('../config/media-quota');

// Esegue il caso di prova dichiarato; le asserzioni confrontano il risultato con quello atteso.
// Riceve: t (contesto del test Node.js).
test('il limite spazio resta attivo senza variabile e rifiuta valori non validi', t => {
    // previous: Riferimento precedente da ripristinare o verificare prima della sostituzione.
    const previous = process.env.MEDIA_STORAGE_LIMIT_BYTES;
    // Ripristina ambiente e risorse al termine del test, anche in caso di fallimento.
    t.after(() => {
        if (previous === undefined) delete process.env.MEDIA_STORAGE_LIMIT_BYTES;
        else process.env.MEDIA_STORAGE_LIMIT_BYTES = previous;
    });
    delete process.env.MEDIA_STORAGE_LIMIT_BYTES;
    assert.equal(getStorageLimitBytes(), 8000000000);
    process.env.MEDIA_STORAGE_LIMIT_BYTES = '';
    assert.equal(getStorageLimitBytes(), 8000000000);
    process.env.MEDIA_STORAGE_LIMIT_BYTES = '1000000000';
    assert.equal(getStorageLimitBytes(), 1000000000);
    // Scorre uno alla volta i valori della raccolta; le variabili del ciclo rappresentano l’elemento corrente.
    // invalid: Riferimento o risultato da valorizzare durante l’operazione.
    for (const invalid of ['0', '-1', 'NaN', '8 GB']) {
        process.env.MEDIA_STORAGE_LIMIT_BYTES = invalid;
        assert.throws(getStorageLimitBytes, { code: 'MEDIA_INVALID_STORAGE_LIMIT' });
    }
});
