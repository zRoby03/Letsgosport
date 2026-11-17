// Trasforma gli input HTTP in dati controllati: i validatori restituiscono value oppure error.
// COURSE_DAYS: Associa le forme normalizzate dei giorni alle etichette accettate dai corsi.
const COURSE_DAYS = new Map([
    ['lunedi', 'Lunedi'],
    ['martedi', 'Martedi'],
    ['mercoledi', 'Mercoledi'],
    ['giovedi', 'Giovedi'],
    ['venerdi', 'Venerdi'],
    ['sabato', 'Sabato'],
    ['domenica', 'Domenica']
]);

// USER_ROLES: Insieme dei ruoli applicativi ammessi dalla validazione.
const USER_ROLES = new Set(['ADMIN', 'COACH', 'PARTNER']);

// parsePositiveId: Converte il valore in un identificativo intero positivo oppure restituisce null.
// Riceve: value (valore da elaborare).
function parsePositiveId(value) {
    // id: Valore convertito o normalizzato prima del suo utilizzo.
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

// cleanText: Converte e rifinisce il testo, controllando obbligatorietà e lunghezze; distingue assenza valida e
// input non valido.
// Riceve: value (valore da elaborare); min (limite inferiore); max (limite superiore); required (se il campo è
// obbligatorio).
function cleanText(value, { min = 0, max = 255, required = false } = {}) {
    if (value === undefined || value === null) {
        return required ? null : '';
    }

    // text: Valore convertito o normalizzato prima del suo utilizzo.
    const text = String(value).trim();
    if (required && text.length < Math.max(1, min)) return null;
    if (text.length < min || text.length > max) return null;
    return text;
}

// parseOptionalAge: Accetta un’età intera nell’intervallo previsto; distingue campo vuoto e valore non valido.
// Riceve: value (valore da elaborare).
function parseOptionalAge(value) {
    if (value === '' || value === undefined || value === null) return null;
    // age: Età convertita in numero per verificarne l’intervallo.
    const age = Number(value);
    return Number.isInteger(age) && age >= 1 && age <= 120 ? age : undefined;
}

// parseRole: Normalizza il ruolo in maiuscolo e restituisce soltanto uno dei ruoli ammessi.
// Riceve: value (valore da elaborare).
function parseRole(value) {
    // role: Ruolo normalizzato da confrontare con quelli ammessi.
    const role = String(value || '').toUpperCase();
    return USER_ROLES.has(role) ? role : null;
}

// parseDate: Controlla formato e validità reale della data, gestendo il campo facoltativo quando richiesto.
// Riceve: value (valore da elaborare); optional (se è consentita l’assenza del valore).
function parseDate(value, { optional = false } = {}) {
    if ((value === '' || value === undefined || value === null) && optional) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;

    // year: Anno estratto dalla data da verificare.
    // month: Mese estratto dalla data, prima dell’adattamento richiesto da Date.
    // day: Giorno del mese estratto dalla data.
    const [year, month, day] = value.split('-').map(Number);
    // date: Oggetto Date usato per controllare o rappresentare un riferimento temporale.
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return undefined;
    }

    return value;
}

// parseTime: Verifica ore, minuti e secondi e restituisce l’orario normalizzato oppure null.
// Riceve: value (valore da elaborare).
function parseTime(value) {
    if (typeof value !== 'string') return null;
    // match: Corrispondenza trovata dall’espressione regolare.
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!match) return null;

    // hours: Componente delle ore della durata o dell’orario.
    const hours = Number(match[1]);
    // minutes: Componente dei minuti della durata o dell’orario.
    const minutes = Number(match[2]);
    // seconds: Componente dei secondi della durata o dell’orario.
    const seconds = Number(match[3] || 0);
    if (hours > 23 || minutes > 59 || seconds > 59) return null;

    return `${match[1]}:${match[2]}:${String(seconds).padStart(2, '0')}`;
}

// parseMoney: Converte il costo in numero non negativo e lo arrotonda ai centesimi, rispettando il limite
// previsto.
// Riceve: value (valore da elaborare).
function parseMoney(value) {
    if (value === '' || value === undefined || value === null) return 0;
    // amount: Importo numerico da controllare e arrotondare.
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return null;
    return Math.round(amount * 100) / 100;
}

// parseCourseDay: Normalizza il giorno della settimana, anche senza accenti, usando la mappa dei giorni ammessi.
// Riceve: value (valore da elaborare).
function parseCourseDay(value) {
    // normalized: Valore normalizzato per un confronto o una validazione coerenti.
    const normalized = cleanText(value, { min: 5, max: 12, required: true });
    if (!normalized) return null;
    return COURSE_DAYS.get(
        normalized.toLocaleLowerCase('it-IT')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
    ) || null;
}

// validateUserUpdate: Valida i campi del profilo modificabili dall’utente e restituisce value oppure error.
// Riceve: body (dati ricevuti dal form).
// Restituisce un oggetto con value normalizzato oppure error.
function validateUserUpdate(body = {}) {
    // nome: Nome letto o normalizzato per il profilo o il form.
    const nome = cleanText(body.nome, { min: 1, max: 50, required: true });
    // cognome: Cognome letto o normalizzato per il profilo.
    const cognome = cleanText(body.cognome, { min: 1, max: 50, required: true });
    // eta: Valore convertito o normalizzato prima del suo utilizzo.
    const eta = parseOptionalAge(body.eta);
    // bio: Risultato di cleanText. Converte e rifinisce il testo, controllando obbligatorietà e lunghezze; distingue
    // assenza valida e input non valido.
    const bio = cleanText(body.bio, { max: 2000 });

    if (!nome || !cognome || eta === undefined || bio === null) {
        return { error: 'Dati utente non validi.' };
    }

    return { value: { nome, cognome, eta, bio } };
}

// validateAdminUserUpdate: Valida il profilo amministrativo, compresi ruolo e scadenza del certificato.
// Riceve: body (dati ricevuti dal form).
// Restituisce un oggetto con value normalizzato oppure error.
function validateAdminUserUpdate(body = {}) {
    // base: Parte principale del nome ripulita oppure indirizzo base del server nel contesto del test.
    const base = validateUserUpdate(body);
    if (base.error) return base;

    // ruolo: Ruolo applicativo usato per stabilire le azioni consentite.
    const ruolo = parseRole(body.ruolo);
    // certificatoScadenza: Valore convertito o normalizzato prima del suo utilizzo.
    const certificatoScadenza = parseDate(body.certificato_scadenza, { optional: true });
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (!ruolo || certificatoScadenza === undefined) {
        return { error: 'Ruolo o scadenza certificato non validi.' };
    }

    return {
        value: {
            ...base.value,
            ruolo,
            certificato_scadenza: certificatoScadenza
        }
    };
}

// validateCourse: Controlla i dati di un corso e restituisce i campi normalizzati oppure un errore.
// Riceve: body (dati ricevuti dal form).
// Restituisce un oggetto con value normalizzato oppure error.
function validateCourse(body = {}) {
    // nome: Nome letto o normalizzato per il profilo o il form.
    const nome = cleanText(body.nome, { min: 2, max: 100, required: true });
    // giorno: Giorno o data formattati per l’interfaccia.
    const giorno = parseCourseDay(body.giorno);
    // orarioInizio: Valore convertito o normalizzato prima del suo utilizzo.
    const orarioInizio = parseTime(body.orario_inizio);
    // durata: Valore convertito o normalizzato prima del suo utilizzo.
    const durata = Number(body.durata);
    // costo: Valore convertito o normalizzato prima del suo utilizzo.
    const costo = parseMoney(body.costo);
    // bio: Risultato di cleanText. Converte e rifinisce il testo, controllando obbligatorietà e lunghezze; distingue
    // assenza valida e input non valido.
    const bio = cleanText(body.bio, { max: 3000 });
    // coachId: Identificativo del coach assegnato o autenticato.
    const coachId = body.coach_id === '' || body.coach_id === undefined || body.coach_id === null
        ? null
        : parsePositiveId(body.coach_id);

    if (
        !nome ||
        !giorno ||
        !orarioInizio ||
        !Number.isInteger(durata) ||
        durata < 1 ||
        durata > 1440 ||
        costo === null ||
        bio === null ||
        (body.coach_id !== '' && body.coach_id !== undefined && body.coach_id !== null && !coachId)
    ) {
        return { error: 'Dati corso non validi.' };
    }

    return {
        value: {
            nome,
            giorno,
            orario_inizio: orarioInizio,
            durata,
            costo,
            bio,
            coach_id: coachId
        }
    };
}

// validateRace: Controlla i dati di una gara e restituisce i campi normalizzati oppure un errore.
// Riceve: body (dati ricevuti dal form).
// Restituisce un oggetto con value normalizzato oppure error.
function validateRace(body = {}) {
    // nome: Nome letto o normalizzato per il profilo o il form.
    const nome = cleanText(body.nome, { min: 2, max: 100, required: true });
    // giorno: Giorno o data formattati per l’interfaccia.
    const giorno = parseDate(body.giorno);
    // orario: Orario formattato per l’interfaccia.
    const orario = parseTime(body.orario);
    // costo: Valore convertito o normalizzato prima del suo utilizzo.
    const costo = parseMoney(body.costo);
    // bio: Risultato di cleanText. Converte e rifinisce il testo, controllando obbligatorietà e lunghezze; distingue
    // assenza valida e input non valido.
    const bio = cleanText(body.bio, { max: 3000 });

    if (!nome || !giorno || !orario || costo === null || bio === null) {
        return { error: 'Dati gara non validi.' };
    }

    return { value: { nome, giorno, orario, costo, bio } };
}

// validateEmail: Controlla il formato dell’indirizzo e lo restituisce normalizzato in minuscolo oppure null.
// Riceve: value (valore da elaborare).
function validateEmail(value) {
    // email: Indirizzo dell’account usato nel controllo o nella richiesta.
    const email = cleanText(value, { min: 5, max: 150, required: true });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return email.toLowerCase();
}

// validateRecaptchaToken: Controlla che il token reCAPTCHA sia presente e abbia una lunghezza ammessa.
// Riceve: value (valore da elaborare).
function validateRecaptchaToken(value) {
    return cleanText(value, { min: 10, max: 4096, required: true });
}

// validateRegistration: Valida i dati di registrazione prima della verifica esterna e dell’hash della password.
// Riceve: body (dati ricevuti dal form).
// Restituisce un oggetto con value normalizzato oppure error.
function validateRegistration(body = {}) {
    // nome: Nome letto o normalizzato per il profilo o il form.
    const nome = cleanText(body.nome, { min: 1, max: 50, required: true });
    // cognome: Cognome letto o normalizzato per il profilo.
    const cognome = cleanText(body.cognome, { min: 1, max: 50, required: true });
    // email: Indirizzo dell’account usato nel controllo o nella richiesta.
    const email = validateEmail(body.email);
    // password: Password mantenuta in memoria per la validazione o il confronto con l’hash.
    const password = typeof body.password === 'string' ? body.password : '';
    // recaptchaToken: Risposta del controllo reCAPTCHA da verificare sul backend.
    const recaptchaToken = validateRecaptchaToken(body.recaptchaToken);

    if (!nome || !cognome || !email || password.length < 8 || password.length > 72) {
        return { error: 'Dati di registrazione non validi.' };
    }
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (!recaptchaToken) return { error: 'Verifica reCAPTCHA mancante o non valida.' };

    return { value: { nome, cognome, email, password, recaptchaToken } };
}

// validateLogin: Valida email, password e token del form di accesso prima di interrogare il database.
// Riceve: body (dati ricevuti dal form).
// Restituisce un oggetto con value normalizzato oppure error.
function validateLogin(body = {}) {
    // email: Indirizzo dell’account usato nel controllo o nella richiesta.
    const email = validateEmail(body.email);
    // password: Password mantenuta in memoria per la validazione o il confronto con l’hash.
    const password = typeof body.password === 'string' ? body.password : '';
    // recaptchaToken: Risposta del controllo reCAPTCHA da verificare sul backend.
    const recaptchaToken = validateRecaptchaToken(body.recaptchaToken);

    if (!email || password.length < 1 || password.length > 72) {
        return { error: 'Email o password non valide.' };
    }
    // Gestisce questo caso di ingresso o di stato con l’esito anticipato indicato nel ramo.
    if (!recaptchaToken) return { error: 'Verifica reCAPTCHA mancante o non valida.' };

    return { value: { email, password, recaptchaToken } };
}

// Espone i metodi e i valori che gli altri moduli possono importare tramite require.
module.exports = {
    cleanText,
    parsePositiveId,
    validateAdminUserUpdate,
    validateCourse,
    validateLogin,
    validateRace,
    validateRegistration,
    validateUserUpdate
};
