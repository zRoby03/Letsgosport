window.app = window.app || {};

window.app.adminApi = {
    listUsers() {
        return window.app.apiRequest('/api/admin/utenti');
    },

    updateUser(userId, payload) {
        return window.app.apiRequest(`/api/admin/utenti/${userId}`, {
            method: 'PUT',
            body: payload
        });
    },

    resetUserPicture(userId) {
        return window.app.apiRequest(`/api/admin/utenti/${userId}/reset-propic`, {
            method: 'PUT'
        });
    },

    deleteUser(userId) {
        return window.app.apiRequest(`/api/admin/utenti/${userId}`, {
            method: 'DELETE'
        });
    },

    listCoaches() {
        return window.app.apiRequest('/api/coaches');
    },

    listCourses() {
        return window.app.apiRequest('/api/corsi');
    },

    saveCourse(courseId, formData) {
        return window.app.apiRequest(
            courseId ? `/api/admin/corsi/${courseId}` : '/api/admin/corsi',
            {
                method: courseId ? 'PUT' : 'POST',
                body: formData,
                timeout: 30000
            }
        );
    },

    deleteCourse(courseId) {
        return window.app.apiRequest(`/api/admin/corsi/${courseId}`, {
            method: 'DELETE'
        });
    },

    listRaces() {
        return window.app.apiRequest('/api/gare');
    },

    saveRace(raceId, formData) {
        return window.app.apiRequest(
            raceId ? `/api/admin/gare/${raceId}` : '/api/admin/gare',
            {
                method: raceId ? 'PUT' : 'POST',
                body: formData,
                timeout: 30000
            }
        );
    },

    deleteRace(raceId) {
        return window.app.apiRequest(`/api/admin/gare/${raceId}`, {
            method: 'DELETE'
        });
    },

    listCoachCourses() {
        return window.app.apiRequest('/api/coach/corsi');
    }
};
