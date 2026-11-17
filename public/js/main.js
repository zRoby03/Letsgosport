// Avvio del frontend: registra gli eventi della pagina, aggiorna il viewport e collega navigazione e funzionalità.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
// Una Promise rappresenta un risultato futuro; le callback ricevono gli esiti e async/await ne rendono sequenziale
// la gestione.
window.app = window.app || {};

// aggiornaAltezzaViewport: Aggiorna la variabile CSS dell’altezza visibile, utile anche quando compare la tastiera
// mobile.
function aggiornaAltezzaViewport() {
    // Lo zoom volontario non deve ridimensionare nuovamente il layout della chat.
    if (window.visualViewport?.scale > 1.01) return;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
    const chat = document.getElementById('pagina-chat');
    if (chat && document.body.classList.contains('chat-page-active')) {
        const chatTop = Math.max(0, chat.getBoundingClientRect().top + window.scrollY);
        document.documentElement.style.setProperty('--chat-available-height', `${Math.max(0, viewportHeight - chatTop)}px`);
    }
}

// nascondiSchermataCaricamento: Nasconde la schermata iniziale quando l’interfaccia è pronta.
function nascondiSchermataCaricamento() {
    // loadingScreen: Elemento DOM loading-screen: Contenitore dell’interfaccia.
    const loadingScreen = document.getElementById('loading-screen');
    if (!loadingScreen || loadingScreen.classList.contains('hidden')) return;

    loadingScreen.classList.add('is-hidden');
    // Esegue l’azione alla scadenza del temporizzatore previsto.
    window.setTimeout(() => {
        loadingScreen.classList.add('hidden');
    }, 650);
}

aggiornaAltezzaViewport();
window.addEventListener('resize', aggiornaAltezzaViewport);
window.visualViewport?.addEventListener('resize', aggiornaAltezzaViewport);
if (typeof ResizeObserver === 'function' && document.querySelector('.navbar')) {
    // Accesso e rotazione possono cambiare l’altezza della navigazione anche senza un resize del browser.
    const navigationObserver = new ResizeObserver(aggiornaAltezzaViewport);
    navigationObserver.observe(document.querySelector('.navbar'));
}

// inizializzaSliderImmagini: Prepara avanzamento, pulsanti e interazioni degli slider presenti nella pagina.
function inizializzaSliderImmagini() {
    // movimentoRidotto: Preferenza di sistema che richiede meno animazioni.
    const movimentoRidotto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Applica l’operazione del blocco a ciascun elemento della raccolta.
    // Riceve: slider (contenitore dello slider).
    document.querySelectorAll('[data-image-slider]').forEach(slider => {
        if (slider.dataset.sliderReady === 'true') return;

        // slides: Elenco dei valori che questo blocco deve confrontare, mostrare o elaborare.
        const slides = [...slider.querySelectorAll('.image-slide')];
        // dotsContainer: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const dotsContainer = slider.querySelector('[data-slider-dots]');
        // status: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const status = slider.querySelector('[data-slider-status]');
        // previousButton: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const previousButton = slider.querySelector('[data-slider-prev]');
        // nextButton: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const nextButton = slider.querySelector('[data-slider-next]');
        // interval: Intervallo fra le immagini dello slider, con il limite minimo previsto dal codice.
        const interval = Math.max(3000, Number(slider.dataset.sliderInterval) || 5000);

        if (slides.length === 0 || !dotsContainer) return;

        slider.dataset.sliderReady = 'true';
        // activeIndex: Indice dell’immagine attualmente visibile nello slider.
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: slide (immagine corrente dello slider).
        let activeIndex = Math.max(0, slides.findIndex(slide => slide.classList.contains('is-active')));
        // rotationTimer: Riferimento all’intervallo automatico dello slider, da annullare durante le pause.
        let rotationTimer = null;

        // dots: Pulsanti di selezione creati per le immagini dello slider.
        // Trasforma l’elemento corrente nel valore da inserire nella nuova raccolta.
        // Riceve: slide (immagine corrente dello slider); index (posizione nell’elenco).
        const dots = slides.map((slide, index) => {
            // dot: Elemento DOM creato per comporre questa parte dell’interfaccia.
            const dot = document.createElement('button');
            // caption: Testo letto dall’elemento DOM e rifinito per questo utilizzo.
            const caption = slide.querySelector('figcaption')?.textContent?.trim();
            dot.type = 'button';
            dot.className = 'image-slider-dot';
            dot.setAttribute('aria-label', caption ? `Mostra: ${caption}` : `Mostra immagine ${index + 1}`);
            // Esegue l’azione del controllo quando viene premuto.
            dot.addEventListener('click', () => {
                mostraSlide(index, true);
                riavviaRotazione();
            });
            dotsContainer.appendChild(dot);
            return dot;
        });

        // mostraSlide: Seleziona l’immagine con indice circolare e aggiorna visibilità, indicatori e annuncio accessibile.
        // Riceve: index (posizione nell’elenco); annuncia (se aggiornare il messaggio accessibile dello slider).
        function mostraSlide(index, annuncia = false) {
            activeIndex = (index + slides.length) % slides.length;
            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: slide (immagine corrente dello slider); slideIndex (indice dell’immagine).
            slides.forEach((slide, slideIndex) => {
                // isActive: Indicatore booleano che controlla la condizione descritta dal nome.
                const isActive = slideIndex === activeIndex;
                slide.classList.toggle('is-active', isActive);
                slide.setAttribute('aria-hidden', String(!isActive));
            });
            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: dot (indicatore dello slider); dotIndex (indice dell’indicatore).
            dots.forEach((dot, dotIndex) => {
                // isActive: Indicatore booleano che controlla la condizione descritta dal nome.
                const isActive = dotIndex === activeIndex;
                dot.classList.toggle('is-active', isActive);
                dot.setAttribute('aria-current', isActive ? 'true' : 'false');
            });
            if (status && annuncia) {
                status.textContent = `Immagine ${activeIndex + 1} di ${slides.length}`;
            }
        }

        // fermaRotazione: Annulla l’intervallo dello slider e svuota il riferimento al temporizzatore.
        function fermaRotazione() {
            if (rotationTimer !== null) window.clearInterval(rotationTimer);
            rotationTimer = null;
        }

        // avviaRotazione: Avvia la rotazione automatica solo se la pagina è visibile e non è richiesto movimento ridotto.
        function avviaRotazione() {
            fermaRotazione();
            if (movimentoRidotto || slides.length < 2 || document.hidden) return;
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            rotationTimer = window.setInterval(() => mostraSlide(activeIndex + 1), interval);
        }

        // riavviaRotazione: Ferma e riavvia il temporizzatore dopo l’interazione con lo slider.
        function riavviaRotazione() {
            fermaRotazione();
            avviaRotazione();
        }

        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        previousButton?.addEventListener('click', () => {
            mostraSlide(activeIndex - 1, true);
            riavviaRotazione();
        });
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        nextButton?.addEventListener('click', () => {
            mostraSlide(activeIndex + 1, true);
            riavviaRotazione();
        });
        // Gestisce i tasti premuti, rispettando le condizioni controllate nel blocco.
        // Riceve: event (evento del browser).
        slider.addEventListener('keydown', event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            mostraSlide(activeIndex + (event.key === 'ArrowRight' ? 1 : -1), true);
            riavviaRotazione();
        });
        slider.addEventListener('pointerenter', fermaRotazione);
        slider.addEventListener('pointerleave', avviaRotazione);
        slider.addEventListener('focusin', fermaRotazione);
        // Reagisce all’evento focusout aggiornando i dati o i controlli previsti.
        slider.addEventListener('focusout', () => {
            // Esegue l’azione alla scadenza del temporizzatore previsto.
            window.setTimeout(() => {
                if (!slider.contains(document.activeElement)) avviaRotazione();
            }, 0);
        });
        // Aggiorna lo stato previsto quando la pagina diventa visibile o viene nascosta.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) fermaRotazione();
            else avviaRotazione();
        });

        mostraSlide(activeIndex);
        avviaRotazione();
    });
}

// Copia le proprietà degli oggetti successivi nel primo oggetto e restituisce l’oggetto aggiornato.
Object.assign(window.app, {
    // isMobileLayout: Indica se dimensioni e orientamento richiedono la modalità di navigazione mobile.
    isMobileLayout() {
        return window.matchMedia(
            '(max-width: 768px), (max-width: 950px) and (max-height: 500px) and (orientation: landscape)'
        ).matches;
    },

    // toggleMenuMobile: Alterna l’apertura del menu di navigazione mobile.
    // Riceve: forceOpen (eventuale stato di apertura imposto).
    toggleMenuMobile(forceOpen) {
        if (!this.isMobileLayout()) return;

        // toggle: Elemento DOM mobile-nav-toggle: Apri menu.
        const toggle = document.getElementById('mobile-nav-toggle');
        // shouldOpen: Indicatore booleano che controlla la condizione descritta dal nome.
        const shouldOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !document.body.classList.contains('mobile-nav-open');

        document.body.classList.toggle('mobile-nav-open', shouldOpen);
        toggle?.setAttribute('aria-expanded', String(shouldOpen));
        toggle?.setAttribute('aria-label', shouldOpen ? 'Chiudi menu' : 'Apri menu');
    },

    // chiudiMenuMobile: Chiude il menu mobile e ripristina i relativi stati accessibili.
    chiudiMenuMobile() {
        document.body.classList.remove('mobile-nav-open');
        // toggle: Elemento DOM mobile-nav-toggle: Apri menu.
        const toggle = document.getElementById('mobile-nav-toggle');
        toggle?.setAttribute('aria-expanded', 'false');
        toggle?.setAttribute('aria-label', 'Apri menu');
    },

    // creaElemento: Restituisce un nuovo elemento DOM con classi, testo e attributi configurati.
    // Riceve: tagName (tipo di elemento HTML da creare); options (opzioni che controllano l’operazione).
    // Restituisce il nodo creato senza inserirlo automaticamente nel documento.
    creaElemento(tagName, options = {}) {
        // element: Elemento DOM creato per comporre questa parte dell’interfaccia.
        const element = document.createElement(tagName);
        if (options.className) element.className = options.className;
        if (options.text !== undefined) element.textContent = String(options.text);
        if (options.attrs) {
            // Applica l’operazione del blocco a ciascun elemento della raccolta.
            // Riceve: name (nome da utilizzare); value (valore da elaborare).
            Object.entries(options.attrs).forEach(([name, value]) => {
                if (value !== undefined && value !== null) element.setAttribute(name, String(value));
            });
        }
        return element;
    },

    // svuotaElemento: Rimuove tutti i figli dell’elemento DOM ricevuto senza sostituire il contenitore.
    // Riceve: element (elemento del DOM).
    svuotaElemento(element) {
        if (!element) return;
        element.replaceChildren();
    },

    // uploadSrc: Restituisce un indirizzo upload coerente con nome e asset inclusi, usando il ripiego per nomi non
    // validi.
    // Riceve: filename (nome del file); fallback (valore o messaggio di ripiego).
    uploadSrc(filename, fallback = 'uploads/defaults/default_user.png') {
        if (!filename) return fallback;
        // cleanName: Nome finale del file, privato dei segmenti di percorso prima del controllo.
        const cleanName = String(filename).replace(/\\/g, '/').split('/').pop();
        if (!cleanName || cleanName === '.' || cleanName === '..') return fallback;
        if (!/^[\w.-]+$/.test(cleanName)) return fallback;

        // staticUploadPaths: Associa i nomi degli asset inclusi ai percorsi statici autorizzati.
        const staticUploadPaths = {
            'default_user.png': 'defaults/default_user.png',
            'default_corso.png': 'defaults/default_corso.png',
            'default_gara.png': 'defaults/default_gara.png',
            'boxe.jpg': 'catalog/boxe.jpg',
            'giocoleria.jpg': 'catalog/giocoleria.jpg'
        };
        if (staticUploadPaths[cleanName]) return `uploads/${staticUploadPaths[cleanName]}`;
        return `uploads/${encodeURIComponent(cleanName)}`;
    }
});

// inizializzaApp: Collega i controlli del DOM alle funzioni dei moduli e avvia i caricamenti iniziali.
// È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
async function inizializzaApp() {
    aggiornaAltezzaViewport();
    inizializzaSliderImmagini();
    document.body.classList.add('mobile-nav-ready');

    // navLabels: Etichette accessibili associate ai pulsanti della navigazione.
    const navLabels = {
        'btn-home-logo': 'Home',
        'btn-home': 'Home',
        'btn-dashboard': 'Corsi',
        'btn-gare': 'Gare',
        'btn-chat': 'Chat',
        'btn-area-mobile': 'Area personale',
        'btn-profilo': 'Profilo',
        'btn-admin': 'Admin',
        'btn-coach': 'Coach',
        'btn-logout': 'Logout',
        'btn-login-nav': 'Login',
        'btn-registrati-nav': 'Registrati'
    };
    // Applica l’operazione del blocco a ciascun elemento della raccolta.
    // Riceve: id (identificativo dell’elemento); label (testo dell’etichetta).
    Object.entries(navLabels).forEach(([id, label]) => {
        // button: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
        const button = document.getElementById(id);
        if (!button) return;
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
    });

    // navbar: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        navbar.id = 'mobile-navigation';
        // Esegue l’azione del controllo quando viene premuto.
        // Riceve: event (evento del browser).
        navbar.addEventListener('click', (event) => {
            if (event.target.closest('#mobile-nav-toggle')) return;
            if (event.target.closest('button')) {
                // Esegue l’azione alla scadenza del temporizzatore previsto.
                window.setTimeout(() => window.app.chiudiMenuMobile(), 0);
            }
        });
    }

    // Applica l’operazione del blocco a ciascun elemento della raccolta.
    // Riceve: element (elemento del DOM).
    document.querySelectorAll('[data-nav]').forEach(element => {
        // Esegue l’azione del controllo quando viene premuto.
        // Riceve: event (evento del browser).
        element.addEventListener('click', event => {
            event.preventDefault();
            // target: Valore della proprietà element.dataset.nav, conservato per le operazioni successive.
            const target = element.dataset.nav;
            if (target) window.app.naviga(target);
        });
    });

    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('mobile-nav-toggle')?.addEventListener('click', () => {
        window.app.toggleMenuMobile();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('mobile-nav-backdrop')?.addEventListener('click', () => {
        window.app.chiudiMenuMobile();
    });

    // Applica l’operazione del blocco a ciascun elemento della raccolta.
    // Riceve: element (elemento del DOM).
    document.querySelectorAll('[data-open-modal]').forEach(element => {
        // Esegue l’azione del controllo quando viene premuto.
        // Riceve: event (evento del browser).
        element.addEventListener('click', event => {
            event.preventDefault();
            window.app.apriModale?.(element.dataset.openModal);
        });
    });

    // Applica l’operazione del blocco a ciascun elemento della raccolta.
    // Riceve: element (elemento del DOM).
    document.querySelectorAll('[data-scroll-target]').forEach(element => {
        // Esegue l’azione del controllo quando viene premuto.
        // Riceve: event (evento del browser).
        element.addEventListener('click', event => {
            event.preventDefault();
            document.getElementById(element.dataset.scrollTarget)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-login-nav')?.addEventListener('click', () => {
        window.app.apriModale?.('modale-login');
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-registrati-nav')?.addEventListener('click', () => {
        window.app.apriModale?.('modale-registrazione');
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-login-home')?.addEventListener('click', () => {
        window.app.apriModale?.('modale-registrazione');
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-logout')?.addEventListener('click', () => {
        window.app.eseguiLogout?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-logout-profilo')?.addEventListener('click', () => {
        window.app.eseguiLogout?.();
    });

    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: event (evento del browser).
    document.getElementById('form-login')?.addEventListener('submit', event => {
        event.preventDefault();
        window.app.eseguiLogin?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: event (evento del browser).
    document.getElementById('form-registrazione')?.addEventListener('submit', event => {
        event.preventDefault();
        window.app.registrati?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: event (evento del browser).
    document.getElementById('link-apri-registrazione')?.addEventListener('click', event => {
        event.preventDefault();
        window.app.chiudiModale?.('modale-login');
        window.app.apriModale?.('modale-registrazione');
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: event (evento del browser).
    document.getElementById('link-apri-login')?.addEventListener('click', event => {
        event.preventDefault();
        window.app.chiudiModale?.('modale-registrazione');
        window.app.apriModale?.('modale-login');
    });

    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-cambia-propic')?.addEventListener('click', () => {
        document.getElementById('input-propic')?.click();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('input-propic')?.addEventListener('change', () => {
        if (typeof window.app.aggiornaPropic === 'function') window.app.aggiornaPropic();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-salva-profilo')?.addEventListener('click', () => {
        if (typeof window.app.aggiornaDatiPersonali === 'function') window.app.aggiornaDatiPersonali();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('coach-search-registro')?.addEventListener('input', () => {
        window.app.filtraAreaCoach?.();
    });

    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-nuova-chat')?.addEventListener('click', () => {
        window.app.apriModaleContatti?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-stato-dnd')?.addEventListener('click', () => {
        window.app.toggleStatoDND?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-notifiche-desktop')?.addEventListener('click', () => {
        window.app.toggleNotificheDesktop?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('nav-room-general')?.addEventListener('click', () => {
        window.app.cambiaStanzaChat?.('general', 'Piazza principale');
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('chat-sidebar-backdrop')?.addEventListener('click', () => {
        window.app.chiudiPannelloChatMobile?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-chat-sidebar-toggle')?.addEventListener('click', () => {
        window.app.togglePannelloChatMobile?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-avvia-chiamata')?.addEventListener('click', () => {
        window.app.avviaChiamata?.();
    });

    // chatFileInput: Elemento DOM input-file-chat: Campo di input.
    const chatFileInput = document.getElementById('input-file-chat');
    // chatAttachButton: Elemento DOM btn-allega-chat: Allega un file.
    const chatAttachButton = document.getElementById('btn-allega-chat');
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    chatAttachButton?.addEventListener('click', () => {
        if (!chatAttachButton.disabled) chatFileInput?.click();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: event (evento del browser).
    chatFileInput?.addEventListener('change', event => window.app.caricaFileChat?.(event));
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-invia-chat')?.addEventListener('click', () => {
        window.app.inviaMessaggio?.();
    });

    // chatInput: Elemento DOM input-messaggio: Campo di input.
    const chatInput = document.getElementById('input-messaggio');
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    chatInput?.addEventListener('input', () => {
        window.app.aggiornaComposerChat?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: event (evento del browser).
    chatInput?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            window.app.inviaMessaggio?.();
        }
    });
    window.app.aggiornaComposerChat?.();
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('input-cerca-contatti')?.addEventListener('input', () => {
        window.app.filtraContatti?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: event (evento del browser).
    document.getElementById('mini-profilo-img')?.addEventListener('click', event => {
        window.app.apriImmagineFullscreen?.(event.currentTarget.src);
    });

    // recordButton: Elemento DOM btn-registra-vocale: Tieni premuto per registrare.
    const recordButton = document.getElementById('btn-registra-vocale');
    // stopRecording: Richiede la fine della registrazione vocale nei gesti di rilascio o interruzione previsti.
    const stopRecording = event => window.app.fermaRegistrazioneVocale?.(event.type !== 'pointerup');
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    // Riceve: event (evento del browser).
    recordButton?.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.isPrimary === false || recordButton.disabled) return;
        event.preventDefault();
        recordButton.setPointerCapture?.(event.pointerId);
        window.app.iniziaRegistrazioneVocale?.();
    });
    recordButton?.addEventListener('pointerup', stopRecording);
    recordButton?.addEventListener('pointercancel', stopRecording);
    recordButton?.addEventListener('lostpointercapture', stopRecording);
    recordButton?.addEventListener('keydown', event => {
        if (![' ', 'Enter'].includes(event.key)) return;
        event.preventDefault();
        if (!event.repeat) window.app.iniziaRegistrazioneVocale?.();
    });
    recordButton?.addEventListener('keyup', event => {
        if (![' ', 'Enter'].includes(event.key)) return;
        event.preventDefault();
        window.app.fermaRegistrazioneVocale?.();
    });
    recordButton?.addEventListener('blur', () => window.app.fermaRegistrazioneVocale?.(true));
    recordButton?.addEventListener('contextmenu', event => event.preventDefault());
    document.getElementById('btn-annulla-vocale')?.addEventListener('click', () => window.app.fermaRegistrazioneVocale?.(true));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') window.app.fermaRegistrazioneVocale?.(true);
    });
    window.addEventListener('blur', () => window.app.fermaRegistrazioneVocale?.(true));
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) window.app.fermaRegistrazioneVocale?.(true);
    });

    // Applica l’operazione del blocco a ciascun elemento della raccolta.
    // Riceve: button (pulsante da configurare).
    document.querySelectorAll('[data-close-modal]').forEach(button => {
        // Esegue l’azione del controllo quando viene premuto. Nasconde la modale identificata dall’id e ripristina gli
        // stati previsti.
        button.addEventListener('click', () => window.app.chiudiModale?.(button.dataset.closeModal));
    });
    // Applica l’operazione del blocco a ciascun elemento della raccolta.
    // Riceve: modalId (id della finestra modale).
    ['modale-login', 'modale-registrazione', 'modale-contatti', 'modale-mini-profilo'].forEach(modalId => {
        // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
        // Riceve: event (evento del browser).
        document.getElementById(modalId)?.addEventListener('click', event => {
            if (event.target.id === modalId) window.app.chiudiModale?.(modalId);
        });
    });

    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-salva-corso')?.addEventListener('click', () => {
        window.app.adminSalvaCorso?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-annulla-corso')?.addEventListener('click', () => {
        window.app.adminAnnullaModifica?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-salva-gara')?.addEventListener('click', () => {
        window.app.adminSalvaGara?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('btn-annulla-gara')?.addEventListener('click', () => {
        window.app.adminAnnullaModificaGara?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('admin-search-utenti')?.addEventListener('input', () => {
        window.app.renderAdminUtenti?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('admin-search-corsi')?.addEventListener('input', () => {
        window.app.renderAdminCorsi?.();
    });
    // Esegue la callback passata all’operazione, utilizzando i parametri forniti dal chiamante.
    document.getElementById('admin-search-gare')?.addEventListener('input', () => {
        window.app.renderAdminGare?.();
    });

    // Gestisce i tasti premuti, rispettando le condizioni controllate nel blocco.
    // Riceve: event (evento del browser).
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') window.app.chiudiMenuMobile();
    });
    // Aggiorna il layout quando cambiano le dimensioni visibili.
    window.addEventListener('resize', () => {
        if (!window.app.isMobileLayout()) window.app.chiudiMenuMobile();
    });

    // collegaBackend: Collega disponibilità del backend, sessione e caricamenti iniziali della pagina.
    // È async: restituisce una Promise; await sospende questa funzione fino al completamento dell’operazione attesa.
    const collegaBackend = async () => {
        if (await window.app.verificaBackend()) {
            await Promise.all([window.app.controllaSeLoggato?.(), window.app.caricaAnteprimaHome?.()]);
        } else {
            // homeCorsi: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
            const homeCorsi = document.querySelector('#home-corsi > p');
            // homeGare: Riferimento al nodo individuato dal selettore, da aggiornare o collegare agli eventi.
            const homeGare = document.querySelector('#home-gare > p');
            if (homeCorsi) homeCorsi.textContent = 'I corsi sono momentaneamente non disponibili.';
            if (homeGare) homeGare.textContent = 'Le gare sono momentaneamente non disponibili.';
            document.getElementById('btn-login-nav')?.classList.remove('hidden');
            document.getElementById('btn-registrati-nav')?.classList.remove('hidden');
            window.app.nascondiSplash?.();
        }
    };
    document.getElementById('stato-backend-riprova')?.addEventListener('click', collegaBackend);
    // Riprende i controlli di disponibilità dopo il ritorno della rete.
    window.addEventListener('online', () => {
        if (window.app.backendDisponibile === false) collegaBackend();
    });
    await collegaBackend();
    // Reagisce all’evento popstate aggiornando i dati o i controlli previsti.
    window.addEventListener('popstate', () => window.app.navigaDaIndirizzo?.());
    if (window.location.hash) window.app.navigaDaIndirizzo?.();

    nascondiSchermataCaricamento();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inizializzaApp, { once: true });
} else {
    inizializzaApp();
}

if (document.readyState === 'complete') {
    nascondiSchermataCaricamento();
} else {
    window.addEventListener('load', nascondiSchermataCaricamento, { once: true });
}

window.setTimeout(nascondiSchermataCaricamento, 2200);
