const COURSE_DAYS = new Map([
    ['lunedi', 'Lunedi'],
    ['martedi', 'Martedi'],
    ['mercoledi', 'Mercoledi'],
    ['giovedi', 'Giovedi'],
    ['venerdi', 'Venerdi'],
    ['sabato', 'Sabato'],
    ['domenica', 'Domenica']
]);

const USER_ROLES = new Set(['ADMIN', 'COACH', 'PARTNER']);

function parsePositiveId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function cleanText(value, { min = 0, max = 255, required = false } = {}) {
    if (value === undefined || value === null) {
        return required ? null : '';
    }

    const text = String(value).trim();
    if (required && text.length < Math.max(1, min)) return null;
    if (text.length < min || text.length > max) return null;
    return text;
}

function parseOptionalAge(value) {
    if (value === '' || value === undefined || value === null) return null;
    const age = Number(value);
    return Number.isInteger(age) && age >= 1 && age <= 120 ? age : undefined;
}

function parseRole(value) {
    const role = String(value || '').toUpperCase();
    return USER_ROLES.has(role) ? role : null;
}

function parseDate(value, { optional = false } = {}) {
    if ((value === '' || value === undefined || value === null) && optional) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;

    const [year, month, day] = value.split('-').map(Number);
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

function parseTime(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);
    if (hours > 23 || minutes > 59 || seconds > 59) return null;

    return `${match[1]}:${match[2]}:${String(seconds).padStart(2, '0')}`;
}

function parseMoney(value) {
    if (value === '' || value === undefined || value === null) return 0;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return null;
    return Math.round(amount * 100) / 100;
}

function parseCourseDay(value) {
    const normalized = cleanText(value, { min: 5, max: 12, required: true });
    if (!normalized) return null;
    return COURSE_DAYS.get(
        normalized.toLocaleLowerCase('it-IT')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
    ) || null;
}

function validateUserUpdate(body = {}) {
    const nome = cleanText(body.nome, { min: 1, max: 50, required: true });
    const cognome = cleanText(body.cognome, { min: 1, max: 50, required: true });
    const eta = parseOptionalAge(body.eta);
    const bio = cleanText(body.bio, { max: 2000 });

    if (!nome || !cognome || eta === undefined || bio === null) {
        return { error: 'Dati utente non validi.' };
    }

    return { value: { nome, cognome, eta, bio } };
}

function validateAdminUserUpdate(body = {}) {
    const base = validateUserUpdate(body);
    if (base.error) return base;

    const ruolo = parseRole(body.ruolo);
    const certificatoScadenza = parseDate(body.certificato_scadenza, { optional: true });
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

function validateCourse(body = {}) {
    const nome = cleanText(body.nome, { min: 2, max: 100, required: true });
    const giorno = parseCourseDay(body.giorno);
    const orarioInizio = parseTime(body.orario_inizio);
    const durata = Number(body.durata);
    const costo = parseMoney(body.costo);
    const bio = cleanText(body.bio, { max: 3000 });
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

function validateRace(body = {}) {
    const nome = cleanText(body.nome, { min: 2, max: 100, required: true });
    const giorno = parseDate(body.giorno);
    const orario = parseTime(body.orario);
    const costo = parseMoney(body.costo);
    const bio = cleanText(body.bio, { max: 3000 });

    if (!nome || !giorno || !orario || costo === null || bio === null) {
        return { error: 'Dati gara non validi.' };
    }

    return { value: { nome, giorno, orario, costo, bio } };
}

function validateEmail(value) {
    const email = cleanText(value, { min: 5, max: 150, required: true });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return email.toLowerCase();
}

function validateRecaptchaToken(value) {
    return cleanText(value, { min: 10, max: 4096, required: true });
}

function validateRegistration(body = {}) {
    const nome = cleanText(body.nome, { min: 1, max: 50, required: true });
    const cognome = cleanText(body.cognome, { min: 1, max: 50, required: true });
    const email = validateEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const recaptchaToken = validateRecaptchaToken(body.recaptchaToken);

    if (!nome || !cognome || !email || password.length < 8 || password.length > 72) {
        return { error: 'Dati di registrazione non validi.' };
    }
    if (!recaptchaToken) return { error: 'Verifica reCAPTCHA mancante o non valida.' };

    return { value: { nome, cognome, email, password, recaptchaToken } };
}

function validateLogin(body = {}) {
    const email = validateEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    const recaptchaToken = validateRecaptchaToken(body.recaptchaToken);

    if (!email || password.length < 1 || password.length > 72) {
        return { error: 'Email o password non valide.' };
    }
    if (!recaptchaToken) return { error: 'Verifica reCAPTCHA mancante o non valida.' };

    return { value: { email, password, recaptchaToken } };
}

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
