class CallRegistry {
    constructor({ ttlMs = 2 * 60 * 60 * 1000 } = {}) {
        this.calls = new Map();
        this.ttlMs = ttlMs;
    }

    key(userId, targetId) {
        const firstId = parsePositiveSafeId(userId);
        const secondId = parsePositiveSafeId(targetId);
        if (!firstId || !secondId || firstId === secondId) return null;

        return [firstId, secondId].sort((a, b) => a - b).join(':');
    }

    prune() {
        const cutoff = Date.now() - this.ttlMs;
        for (const [key, call] of this.calls) {
            if (call.updatedAt < cutoff) this.calls.delete(key);
        }
    }

    get(userId, targetId) {
        const key = this.key(userId, targetId);
        return key ? this.calls.get(key) : null;
    }

    hasOtherCall(userId, allowedKey) {
        const currentUserId = parsePositiveSafeId(userId);
        if (!currentUserId) return false;

        for (const [key, call] of this.calls) {
            if (key !== allowedKey && call.participants.has(currentUserId)) return true;
        }
        return false;
    }

    start(userId, targetId) {
        this.prune();
        const key = this.key(userId, targetId);
        if (!key) return null;
        const firstId = parsePositiveSafeId(userId);
        const secondId = parsePositiveSafeId(targetId);

        if (this.hasOtherCall(userId, key) || this.hasOtherCall(targetId, key)) return null;

        const call = {
            participants: new Set([firstId, secondId]),
            updatedAt: Date.now()
        };
        this.calls.set(key, call);
        return call;
    }

    touch(userId, targetId) {
        const call = this.get(userId, targetId);
        if (call) call.updatedAt = Date.now();
        return call;
    }

    end(userId, targetId) {
        const key = this.key(userId, targetId);
        if (!key) return false;
        if (!this.calls.has(key)) return false;
        this.calls.delete(key);
        return true;
    }

    removeUser(userId) {
        const endedCalls = [];
        for (const [key, call] of this.calls) {
            if (!call.participants.has(Number(userId))) continue;
            const otherUserId = [...call.participants].find(id => id !== Number(userId));
            this.calls.delete(key);
            endedCalls.push(otherUserId);
        }
        return endedCalls.filter(Boolean);
    }
}

function parsePositiveSafeId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeChatRoom(value) {
    if (typeof value !== 'string') return null;

    const room = value.trim();
    if (!room || room.length > 50) return null;
    if (room === 'general') return { room, type: 'general' };

    const privateMatch = /^private_(\d+)_(\d+)$/.exec(room);
    if (privateMatch) {
        const firstId = parsePositiveSafeId(privateMatch[1]);
        const secondId = parsePositiveSafeId(privateMatch[2]);
        if (!firstId || !secondId || firstId === secondId) return null;

        const normalizedRoom = `private_${Math.min(firstId, secondId)}_${Math.max(firstId, secondId)}`;
        if (room !== normalizedRoom) return null;

        return {
            room,
            type: 'private',
            userIds: [firstId, secondId]
        };
    }

    const courseMatch = /^corso_(\d+)$/.exec(room);
    if (courseMatch) {
        const id = parsePositiveSafeId(courseMatch[1]);
        return id ? { room, type: 'corso', id } : null;
    }

    const raceMatch = /^gara_(\d+)$/.exec(room);
    if (raceMatch) {
        const id = parsePositiveSafeId(raceMatch[1]);
        return id ? { room, type: 'gara', id } : null;
    }

    return null;
}

function getPrivateRoomPeer(room, userId) {
    const chatRoom = normalizeChatRoom(room);
    const currentUserId = parsePositiveSafeId(userId);
    if (!chatRoom || chatRoom.type !== 'private' || !currentUserId) return null;
    if (!chatRoom.userIds.includes(currentUserId)) return null;

    return chatRoom.userIds.find(id => id !== currentUserId) || null;
}

function isValidSdp(sdp, expectedType) {
    return Boolean(
        sdp &&
        typeof sdp === 'object' &&
        sdp.type === expectedType &&
        typeof sdp.sdp === 'string' &&
        sdp.sdp.length > 0 &&
        sdp.sdp.length <= 200000
    );
}

function isValidIceCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') return false;
    if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 20000) return false;
    try {
        return JSON.stringify(candidate).length <= 30000;
    } catch {
        return false;
    }
}

function createRateLimiter(limit, windowMs) {
    let windowStart = Date.now();
    let count = 0;
    return () => {
        const now = Date.now();
        if (now - windowStart >= windowMs) {
            windowStart = now;
            count = 0;
        }
        count += 1;
        return count <= limit;
    };
}

module.exports = {
    CallRegistry,
    createRateLimiter,
    getPrivateRoomPeer,
    isValidIceCandidate,
    isValidSdp,
    normalizeChatRoom,
    parsePositiveSafeId
};
