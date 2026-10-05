window.app = window.app || {};

function aggiornaAltezzaViewport() {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
}

function nascondiSchermataCaricamento() {
    const loadingScreen = document.getElementById('loading-screen');
    if (!loadingScreen || loadingScreen.classList.contains('hidden')) return;

    loadingScreen.classList.add('is-hidden');
    window.setTimeout(() => {
        loadingScreen.classList.add('hidden');
    }, 650);
}

aggiornaAltezzaViewport();
window.addEventListener('resize', aggiornaAltezzaViewport);
window.visualViewport?.addEventListener('resize', aggiornaAltezzaViewport);

function inizializzaSliderImmagini() {
    const movimentoRidotto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    document.querySelectorAll('[data-image-slider]').forEach(slider => {
        if (slider.dataset.sliderReady === 'true') return;

        const slides = [...slider.querySelectorAll('.image-slide')];
        const dotsContainer = slider.querySelector('[data-slider-dots]');
        const status = slider.querySelector('[data-slider-status]');
        const previousButton = slider.querySelector('[data-slider-prev]');
        const nextButton = slider.querySelector('[data-slider-next]');
        const interval = Math.max(3000, Number(slider.dataset.sliderInterval) || 5000);

        if (slides.length === 0 || !dotsContainer) return;

        slider.dataset.sliderReady = 'true';
        let activeIndex = Math.max(0, slides.findIndex(slide => slide.classList.contains('is-active')));
        let rotationTimer = null;

        const dots = slides.map((slide, index) => {
            const dot = document.createElement('button');
            const caption = slide.querySelector('figcaption')?.textContent?.trim();
            dot.type = 'button';
            dot.className = 'image-slider-dot';
            dot.setAttribute('aria-label', caption ? `Mostra: ${caption}` : `Mostra immagine ${index + 1}`);
            dot.addEventListener('click', () => {
                mostraSlide(index, true);
                riavviaRotazione();
            });
            dotsContainer.appendChild(dot);
            return dot;
        });

        function mostraSlide(index, annuncia = false) {
            activeIndex = (index + slides.length) % slides.length;
            slides.forEach((slide, slideIndex) => {
                const isActive = slideIndex === activeIndex;
                slide.classList.toggle('is-active', isActive);
                slide.setAttribute('aria-hidden', String(!isActive));
            });
            dots.forEach((dot, dotIndex) => {
                const isActive = dotIndex === activeIndex;
                dot.classList.toggle('is-active', isActive);
                dot.setAttribute('aria-current', isActive ? 'true' : 'false');
            });
            if (status && annuncia) {
                status.textContent = `Immagine ${activeIndex + 1} di ${slides.length}`;
            }
        }

        function fermaRotazione() {
            if (rotationTimer !== null) window.clearInterval(rotationTimer);
            rotationTimer = null;
        }

        function avviaRotazione() {
            fermaRotazione();
            if (movimentoRidotto || slides.length < 2 || document.hidden) return;
            rotationTimer = window.setInterval(() => mostraSlide(activeIndex + 1), interval);
        }

        function riavviaRotazione() {
            fermaRotazione();
            avviaRotazione();
        }

        previousButton?.addEventListener('click', () => {
            mostraSlide(activeIndex - 1, true);
            riavviaRotazione();
        });
        nextButton?.addEventListener('click', () => {
            mostraSlide(activeIndex + 1, true);
            riavviaRotazione();
        });
        slider.addEventListener('keydown', event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            mostraSlide(activeIndex + (event.key === 'ArrowRight' ? 1 : -1), true);
            riavviaRotazione();
        });
        slider.addEventListener('pointerenter', fermaRotazione);
        slider.addEventListener('pointerleave', avviaRotazione);
        slider.addEventListener('focusin', fermaRotazione);
        slider.addEventListener('focusout', () => {
            window.setTimeout(() => {
                if (!slider.contains(document.activeElement)) avviaRotazione();
            }, 0);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) fermaRotazione();
            else avviaRotazione();
        });

        mostraSlide(activeIndex);
        avviaRotazione();
    });
}

Object.assign(window.app, {
    isMobileLayout() {
        return window.matchMedia(
            '(max-width: 768px), (max-width: 950px) and (max-height: 500px) and (orientation: landscape)'
        ).matches;
    },

    toggleMenuMobile(forceOpen) {
        if (!this.isMobileLayout()) return;

        const toggle = document.getElementById('mobile-nav-toggle');
        const shouldOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !document.body.classList.contains('mobile-nav-open');

        document.body.classList.toggle('mobile-nav-open', shouldOpen);
        toggle?.setAttribute('aria-expanded', String(shouldOpen));
        toggle?.setAttribute('aria-label', shouldOpen ? 'Chiudi menu' : 'Apri menu');
    },

    chiudiMenuMobile() {
        document.body.classList.remove('mobile-nav-open');
        const toggle = document.getElementById('mobile-nav-toggle');
        toggle?.setAttribute('aria-expanded', 'false');
        toggle?.setAttribute('aria-label', 'Apri menu');
    },

    creaElemento(tagName, options = {}) {
        const element = document.createElement(tagName);
        if (options.className) element.className = options.className;
        if (options.text !== undefined) element.textContent = String(options.text);
        if (options.attrs) {
            Object.entries(options.attrs).forEach(([name, value]) => {
                if (value !== undefined && value !== null) element.setAttribute(name, String(value));
            });
        }
        return element;
    },

    svuotaElemento(element) {
        if (!element) return;
        element.replaceChildren();
    },

    uploadSrc(filename, fallback = 'uploads/defaults/default_user.png') {
        if (!filename) return fallback;
        const cleanName = String(filename).replace(/\\/g, '/').split('/').pop();
        if (!cleanName || cleanName === '.' || cleanName === '..') return fallback;
        if (!/^[\w.-]+$/.test(cleanName)) return fallback;

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

async function inizializzaApp() {
    aggiornaAltezzaViewport();
    inizializzaSliderImmagini();
    document.body.classList.add('mobile-nav-ready');

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
    Object.entries(navLabels).forEach(([id, label]) => {
        const button = document.getElementById(id);
        if (!button) return;
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
    });

    const navbar = document.querySelector('.navbar');
    if (navbar) {
        navbar.id = 'mobile-navigation';
        navbar.addEventListener('click', (event) => {
            if (event.target.closest('#mobile-nav-toggle')) return;
            if (event.target.closest('button')) {
                window.setTimeout(() => window.app.chiudiMenuMobile(), 0);
            }
        });
    }

    document.querySelectorAll('[data-nav]').forEach(element => {
        element.addEventListener('click', event => {
            event.preventDefault();
            const target = element.dataset.nav;
            if (target) window.app.naviga(target);
        });
    });

    document.getElementById('mobile-nav-toggle')?.addEventListener('click', () => {
        window.app.toggleMenuMobile();
    });
    document.getElementById('mobile-nav-backdrop')?.addEventListener('click', () => {
        window.app.chiudiMenuMobile();
    });

    document.querySelectorAll('[data-open-modal]').forEach(element => {
        element.addEventListener('click', event => {
            event.preventDefault();
            window.app.apriModale?.(element.dataset.openModal);
        });
    });

    document.querySelectorAll('[data-scroll-target]').forEach(element => {
        element.addEventListener('click', event => {
            event.preventDefault();
            document.getElementById(element.dataset.scrollTarget)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    document.getElementById('btn-login-nav')?.addEventListener('click', () => {
        window.app.apriModale?.('modale-login');
    });
    document.getElementById('btn-registrati-nav')?.addEventListener('click', () => {
        window.app.apriModale?.('modale-registrazione');
    });
    document.getElementById('btn-login-home')?.addEventListener('click', () => {
        window.app.apriModale?.('modale-registrazione');
    });
    document.getElementById('btn-logout')?.addEventListener('click', () => {
        window.app.eseguiLogout?.();
    });
    document.getElementById('btn-logout-profilo')?.addEventListener('click', () => {
        window.app.eseguiLogout?.();
    });

    document.getElementById('form-login')?.addEventListener('submit', event => {
        event.preventDefault();
        window.app.eseguiLogin?.();
    });
    document.getElementById('form-registrazione')?.addEventListener('submit', event => {
        event.preventDefault();
        window.app.registrati?.();
    });
    document.getElementById('link-apri-registrazione')?.addEventListener('click', event => {
        event.preventDefault();
        window.app.chiudiModale?.('modale-login');
        window.app.apriModale?.('modale-registrazione');
    });
    document.getElementById('link-apri-login')?.addEventListener('click', event => {
        event.preventDefault();
        window.app.chiudiModale?.('modale-registrazione');
        window.app.apriModale?.('modale-login');
    });

    document.getElementById('btn-cambia-propic')?.addEventListener('click', () => {
        document.getElementById('input-propic')?.click();
    });
    document.getElementById('input-propic')?.addEventListener('change', () => {
        if (typeof window.app.aggiornaPropic === 'function') window.app.aggiornaPropic();
    });
    document.getElementById('btn-salva-profilo')?.addEventListener('click', () => {
        if (typeof window.app.aggiornaDatiPersonali === 'function') window.app.aggiornaDatiPersonali();
    });
    document.getElementById('coach-search-registro')?.addEventListener('input', () => {
        window.app.filtraAreaCoach?.();
    });

    document.getElementById('btn-nuova-chat')?.addEventListener('click', () => {
        window.app.apriModaleContatti?.();
    });
    document.getElementById('btn-stato-dnd')?.addEventListener('click', () => {
        window.app.toggleStatoDND?.();
    });
    document.getElementById('btn-notifiche-desktop')?.addEventListener('click', () => {
        window.app.toggleNotificheDesktop?.();
    });
    document.getElementById('nav-room-general')?.addEventListener('click', () => {
        window.app.cambiaStanzaChat?.('general', 'Piazza principale');
    });
    document.getElementById('chat-sidebar-backdrop')?.addEventListener('click', () => {
        window.app.chiudiPannelloChatMobile?.();
    });
    document.getElementById('btn-chat-sidebar-toggle')?.addEventListener('click', () => {
        window.app.togglePannelloChatMobile?.();
    });
    document.getElementById('btn-avvia-chiamata')?.addEventListener('click', () => {
        window.app.avviaChiamata?.();
    });

    const chatFileInput = document.getElementById('input-file-chat');
    const chatAttachButton = document.getElementById('btn-allega-chat');
    chatAttachButton?.addEventListener('click', () => {
        if (!chatAttachButton.disabled) chatFileInput?.click();
    });
    chatFileInput?.addEventListener('change', event => window.app.caricaFileChat?.(event));
    document.getElementById('btn-invia-chat')?.addEventListener('click', () => {
        window.app.inviaMessaggio?.();
    });

    const chatInput = document.getElementById('input-messaggio');
    chatInput?.addEventListener('input', () => {
        window.app.aggiornaComposerChat?.();
    });
    chatInput?.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            window.app.inviaMessaggio?.();
        }
    });
    window.app.aggiornaComposerChat?.();
    document.getElementById('input-cerca-contatti')?.addEventListener('input', () => {
        window.app.filtraContatti?.();
    });
    document.getElementById('mini-profilo-img')?.addEventListener('click', event => {
        window.app.apriImmagineFullscreen?.(event.currentTarget.src);
    });

    const recordButton = document.getElementById('btn-registra-vocale');
    const stopRecording = () => window.app.fermaRegistrazioneVocale?.();
    recordButton?.addEventListener('pointerdown', event => {
        event.preventDefault();
        recordButton.setPointerCapture?.(event.pointerId);
        window.app.iniziaRegistrazioneVocale?.();
    });
    recordButton?.addEventListener('pointerup', stopRecording);
    recordButton?.addEventListener('pointercancel', stopRecording);
    recordButton?.addEventListener('lostpointercapture', stopRecording);

    document.querySelectorAll('[data-close-modal]').forEach(button => {
        button.addEventListener('click', () => window.app.chiudiModale?.(button.dataset.closeModal));
    });
    ['modale-login', 'modale-registrazione', 'modale-contatti', 'modale-mini-profilo'].forEach(modalId => {
        document.getElementById(modalId)?.addEventListener('click', event => {
            if (event.target.id === modalId) window.app.chiudiModale?.(modalId);
        });
    });

    document.getElementById('btn-salva-corso')?.addEventListener('click', () => {
        window.app.adminSalvaCorso?.();
    });
    document.getElementById('btn-annulla-corso')?.addEventListener('click', () => {
        window.app.adminAnnullaModifica?.();
    });
    document.getElementById('btn-salva-gara')?.addEventListener('click', () => {
        window.app.adminSalvaGara?.();
    });
    document.getElementById('btn-annulla-gara')?.addEventListener('click', () => {
        window.app.adminAnnullaModificaGara?.();
    });
    document.getElementById('admin-search-utenti')?.addEventListener('input', () => {
        window.app.renderAdminUtenti?.();
    });
    document.getElementById('admin-search-corsi')?.addEventListener('input', () => {
        window.app.renderAdminCorsi?.();
    });
    document.getElementById('admin-search-gare')?.addEventListener('input', () => {
        window.app.renderAdminGare?.();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') window.app.chiudiMenuMobile();
    });
    window.addEventListener('resize', () => {
        if (!window.app.isMobileLayout()) window.app.chiudiMenuMobile();
    });

    const backendDisponibile = typeof window.app.verificaBackend === 'function'
        ? await window.app.verificaBackend()
        : true;

    if (backendDisponibile && typeof window.app.controllaSeLoggato === 'function') {
        await window.app.controllaSeLoggato();
    } else if (!backendDisponibile) {
        document.getElementById('btn-login-nav')?.classList.remove('hidden');
        document.getElementById('btn-registrati-nav')?.classList.remove('hidden');
        window.app.nascondiSplash?.();
    }

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
