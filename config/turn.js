// Genera sul backend credenziali TURN temporanee; il browser non riceve il token permanente del provider.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
// createHmac: Costruisce una firma autenticata mediante un segreto condiviso.
const { createHmac } = require('node:crypto');
// axios: Axios invia richieste HTTP ai servizi esterni e supporta timeout ed errori di risposta.
const axios = require('axios');

// turnError: Costruisce un errore TURN con codice e stato HTTP, senza includere credenziali del provider.
// Riceve: code (codice tecnico dell’errore); status (codice HTTP).
function turnError(code, status = 503) {
    // Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
    return Object.assign(new Error('Servizio TURN non disponibile.'), { code, status });
}

// getIceServers: Restituisce server ICE con credenziali temporanee dopo i controlli su configurazione ed email
// autorizzate.
// Riceve: user (dati dell’utente).
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
// La Promise restituisce un elenco di configurazioni ICE; l’elenco è vuoto quando il relay è disattivato o
// assente.
async function getIceServers(user) {
    if (['false', '0'].includes(String(process.env.TURN_ENABLED || '').trim().toLowerCase())) return [];

    // keyId: Identificativo della chiave TURN configurata sul provider.
    const keyId = String(process.env.TURN_KEY_ID || '').trim();
    // apiToken: Token del backend usato per richiedere credenziali TURN temporanee.
    const apiToken = String(process.env.TURN_KEY_API_TOKEN || '').trim();
    // urls: Indirizzi STUN o TURN ammessi dalla configurazione o dalla risposta.
    const urls = String(process.env.TURN_URLS || '').split(',')
        // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
        // Riceve: url (indirizzo della risorsa o del servizio).
        .map(url => url.trim())
        // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
        // Riceve: url (indirizzo della risorsa o del servizio).
        .filter(url => /^turns?:[^\s]+$/i.test(url));
    // secret: Segreto usato dal backend per la firma prevista dal modulo.
    const secret = process.env.TURN_SHARED_SECRET;
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (!keyId && !apiToken && (!urls.length || !secret)) return [];

    // allowedEmails: Indirizzi degli account ammessi al relay TURN quando è impostata la lista.
    const allowedEmails = String(process.env.TURN_ALLOWED_EMAILS || '').split(',')
        // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
        // Riceve: email (indirizzo dell’account).
        .map(email => email.trim().toLowerCase()).filter(Boolean);
    if (allowedEmails.length && !allowedEmails.includes(String(user.email || '').trim().toLowerCase())) {
        throw turnError('TURN_USER_NOT_ALLOWED', 403);
    }

    // ttl: Durata delle credenziali temporanee espressa in secondi.
    const ttl = Number(process.env.TURN_TTL_SECONDS || 14400);
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 172800) throw turnError('TURN_INVALID_TTL');

    if (keyId || apiToken) {
        // Rifiuta lo stato non valido sollevando l’errore previsto, senza proseguire con le operazioni successive.
        if (!/^[a-f0-9]{32}$/i.test(keyId) || !apiToken) throw turnError('TURN_INVALID_CONFIGURATION');
        // data: Risposta JSON del provider TURN da interpretare e validare.
        let data;
        try {
            ({ data } = await axios.post(
                'https://rtc.live.cloudflare.com/v1/turn/keys/' + keyId + '/credentials/generate-ice-servers',
                { ttl },
                {
                    // headers: Intestazioni HTTP aggiuntive associate alla richiesta.
                    headers: { Authorization: 'Bearer ' + apiToken, 'Content-Type': 'application/json' },
                    // timeout: Tempo massimo dell’operazione espresso in millisecondi.
                    timeout: 3500,
                    maxRedirects: 0
                }
            ));
        } catch {
            // Provider errors can contain authorization headers: only expose a fixed error code.
            throw turnError('TURN_PROVIDER_UNAVAILABLE');
        }
        if (!Array.isArray(data?.iceServers)) throw turnError('TURN_INVALID_RESPONSE');
        // servers: Elenco dei server ICE validati da restituire al browser.
        // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
        // Riceve: server (configurazione del server ICE).
        const servers = data.iceServers.flatMap(server => {
            // values: Valore scelto tra i due rami in base alla condizione indicata.
            const values = Array.isArray(server?.urls) ? server.urls : [server?.urls];
            // addresses: Indirizzi del server ICE che rispettano i protocolli ammessi.
            // Restituisce il criterio che decide quali elementi conservare nella nuova lista.
            // Riceve: url (indirizzo della risorsa o del servizio).
            const addresses = values.filter(url => typeof url === 'string' && /^(?:stun|stuns|turn|turns):[^\s]+$/i.test(url));
            if (!addresses.length) return [];
            // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
            // Riceve: url (indirizzo della risorsa o del servizio).
            if (addresses.some(url => /^turns?:/i.test(url))) {
                if (typeof server.username !== 'string' || !server.username ||
                    typeof server.credential !== 'string' || !server.credential) return [];
                return [{ urls: addresses, username: server.username, credential: server.credential }];
            }
            return [{ urls: addresses }];
        });
        // Controlla il criterio che deve essere soddisfatto da almeno un elemento.
        // Riceve: server (configurazione del server ICE).
        // Riceve: url (indirizzo della risorsa o del servizio).
        if (!servers.some(server => server.urls.some(url => /^turns?:/i.test(url)))) {
            throw turnError('TURN_INVALID_RESPONSE');
        }
        return servers;
    }

    // expiresAt: Istante di scadenza del token o delle credenziali.
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    // username: Nome utente delle credenziali temporanee generato o ricevuto dal provider.
    const username = expiresAt + ':' + user.id;
    // credential: Credenziale temporanea usata dal client per autenticarsi al relay.
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    return [{ urls, username, credential }];
}

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = { getIceServers };
