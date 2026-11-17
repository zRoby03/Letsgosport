// Frontend: raggruppa le richieste HTTP amministrative, lasciando la costruzione del DOM agli altri moduli.
// Il frontend gira nel browser: il DOM rappresenta gli elementi HTML e gli eventi collegano le azioni dell’utente
// ai metodi.
window.app = window.app || {};

window.app.adminApi = {
    // listUsers: Richiede al backend l’elenco degli utenti per l’amministratore.
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    listUsers() {
        return window.app.apiRequest('/api/admin/utenti');
    },

    // updateUser: Invia al backend le modifiche amministrative dell’utente indicato.
    // Riceve: userId (id dell’utente); payload (dati dell’operazione).
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    updateUser(userId, payload) {
        return window.app.apiRequest(`/api/admin/utenti/${userId}`, {
            // method: Metodo HTTP che identifica l’operazione richiesta al backend.
            method: 'PUT',
            body: payload
        });
    },

    // resetUserPicture: Richiede il ripristino dell’immagine predefinita del profilo.
    // Riceve: userId (id dell’utente).
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    resetUserPicture(userId) {
        return window.app.apiRequest(`/api/admin/utenti/${userId}/reset-propic`, {
            // method: Metodo HTTP che identifica l’operazione richiesta al backend.
            method: 'PUT'
        });
    },

    // deleteUser: Richiede al backend l’eliminazione dell’utente indicato.
    // Riceve: userId (id dell’utente).
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    deleteUser(userId) {
        return window.app.apiRequest(`/api/admin/utenti/${userId}`, {
            // method: Metodo HTTP che identifica l’operazione richiesta al backend.
            method: 'DELETE'
        });
    },

    // listCoaches: Richiede i coach selezionabili nei form dei corsi.
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    listCoaches() {
        return window.app.apiRequest('/api/coaches');
    },

    // listCourses: Richiede il catalogo dei corsi usato dall’amministrazione.
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    listCourses() {
        return window.app.apiRequest('/api/corsi');
    },

    // saveCourse: Crea o aggiorna il corso, inviando anche il form multipart quando previsto.
    // Riceve: courseId (id del corso); formData (dati multipart del form).
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    saveCourse(courseId, formData) {
        return window.app.apiRequest(
            courseId ? `/api/admin/corsi/${courseId}` : '/api/admin/corsi',
            {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
                method: courseId ? 'PUT' : 'POST',
                body: formData,
                // timeout: Tempo massimo dell’operazione espresso in millisecondi.
                timeout: 30000
            }
        );
    },

    // deleteCourse: Richiede l’eliminazione del corso indicato.
    // Riceve: courseId (id del corso).
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    deleteCourse(courseId) {
        return window.app.apiRequest(`/api/admin/corsi/${courseId}`, {
            // method: Metodo HTTP che identifica l’operazione richiesta al backend.
            method: 'DELETE'
        });
    },

    // listRaces: Richiede il catalogo delle gare usato dall’amministrazione.
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    listRaces() {
        return window.app.apiRequest('/api/gare');
    },

    // saveRace: Crea o aggiorna la gara inviando i dati del form.
    // Riceve: raceId (id della gara); formData (dati multipart del form).
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    saveRace(raceId, formData) {
        return window.app.apiRequest(
            raceId ? `/api/admin/gare/${raceId}` : '/api/admin/gare',
            {
                // method: Metodo HTTP che identifica l’operazione richiesta al backend.
                method: raceId ? 'PUT' : 'POST',
                body: formData,
                // timeout: Tempo massimo dell’operazione espresso in millisecondi.
                timeout: 30000
            }
        );
    },

    // deleteRace: Richiede l’eliminazione della gara indicata.
    // Riceve: raceId (id della gara).
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    deleteRace(raceId) {
        return window.app.apiRequest(`/api/admin/gare/${raceId}`, {
            // method: Metodo HTTP che identifica l’operazione richiesta al backend.
            method: 'DELETE'
        });
    },

    // listCoachCourses: Richiede corsi e iscritti disponibili nell’area del coach autenticato.
    // Restituisce la Promise della richiesta al backend, con i dati oppure un errore per il chiamante.
    listCoachCourses() {
        return window.app.apiRequest('/api/coach/corsi');
    }
};
