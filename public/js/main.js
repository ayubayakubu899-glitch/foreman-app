console.log('===== MAIN.JS LOADING =====');

function createErrorOverlay() {
    let overlay = document.getElementById('app-error-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'app-error-overlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0,0,0,0.95)';
        overlay.style.color = '#fff';
        overlay.style.zIndex = '99999';
        overlay.style.padding = '24px';
        overlay.style.overflowY = 'auto';
        overlay.style.fontFamily = 'Segoe UI, sans-serif';
        overlay.style.fontSize = '15px';
        overlay.style.lineHeight = '1.6';
        document.body.appendChild(overlay);
    }
    return overlay;
}

function showGlobalAppError(message, details) {
    const overlay = createErrorOverlay();
    overlay.innerHTML = `
        <h1 style="margin-top:0;color:#ff6b6b;">Application error</h1>
        <p>${message}</p>
        <pre style="white-space: pre-wrap; color:#f8f8f2; background: rgba(255,255,255,0.08); padding:12px; border-radius:10px;">${details || 'No additional details.'}</pre>
    `;
}

window.addEventListener('error', (event) => {
    console.error('Global window error:', event.error || event.message, event);
    showGlobalAppError('An unexpected error occurred.', `${event.message || event.error?.message}

${event.filename}:${event.lineno}:${event.colno}`);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showGlobalAppError('Unhandled promise rejection.', `${event.reason && event.reason.stack ? event.reason.stack : String(event.reason)}`);
});

const socket = io();
console.log('Socket initialized:', socket);

socket.on('connect', () => {
    console.log('✓✓✓ SOCKET CONNECTED ✓✓✓', socket.id);
});

socket.on('disconnect', () => {
    console.log('❌ SOCKET DISCONNECTED');
});

// --- Global State ---
let connectedUsers = [];
let allRegisteredUsers = []; // All users from database
let onlineUserIds = new Set(); // Track online user IDs
let selectedUser = null;
let userConversations = {}; // Store conversations per user (keyed by dbId when available)
let unreadMessages = {}; // Track unread message count per user
let pendingOutbox = {}; // Queue messages for offline recipients
let map = null;
let pins = [];
let mapVisible = false;
let peer = null;
let currentCall = null;
let localStream = null;
let callTimer = null;
let callStartTime = null;
let currentSpeakerVolume = 1.0;
let isMicMuted = false;
let typingTimer = null;
let remoteTypingTimer = null;
let currentSearchQuery = '';
let replyingTo = null;
let liveLocationTimers = {};
let mapSearchMarker = null;
let mapSearchAutocomplete = null;
let lastDroppedPin = null;
let locationShareContext = 'chat';
let selectedLiveDurationMinutes = 15;
let voiceMediaRecorder = null;
let voiceRecordingChunks = [];
let voiceRecordingStream = null;
let isVoiceRecording = false;
let voiceRecordingStartedAt = 0;
let pendingVoicePreviewData = null;
let pendingVoicePreviewUrl = null;
let pendingVoicePreviewDuration = 0;
let pendingVoiceBlob = null;
let foremanStatsCache = {}; // { [foremanId]: { jobsDone, averageRating, hasRating, loading } }
let notificationWorkerRegistration = null;
let groups = [];
let selectedGroup = null;
let hasUnlockedCallAudio = false;
let plusMenuOpen = false;
let voiceRecordingMode = 'hold';
let voiceRecordingTimer = null;
let voiceRecordingPausedAt = 0;
let voiceStopIntent = 'preview';

const VOICE_RECORDING_MAX_SECONDS = 300;

const notificationPreferenceDefaults = {
    messages: true,
    calls: true,
    pins: true
};

// Create ringtone audio element
const ringtone = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIF2i6/eeuTRALT6fk7bhiHAU7k9jzznwsBS59y/DajToIDmS56+ijUxMGQ5zd8sFuIgUugM7y24k2CBdou/3nrk0QC0+n5O26YxsGOpPY8858LAYufcvw2o06CA5kuevoo1MTBkOc3fLBbiIFL4HO8tuJNggXaLv9565NEAtPp+TtumMbBjqT2PPOfCwGLn3L8NqNOggOZLnr6KNTEwZDnN3ywW4iBTCBzvLbiTYIF2i7/eeuTRALT6fk7bpjGwY6k9jzznwsBi59y/DajToIDmS56+ijUxMGQ5zd8sFuIgUwgc7y24k2CBdou/3nrk0QC0+n5O26YxsGOpPY8858LAYufcvw2o06CA5kuevoo1MTBkOc3fLBbiIFMIHO8tuJNggXaLv9565NEAtPp+TtumMbBjqT2PPOfCwGLn3L8NqNOggOZLnr6KNTEwZDnN3ywW4iBTCBzvLbiTYIF2i7/eeuTRALT6fk7bpjGwY6k9jzznwsBi59y/DajToIDmS56+ijUxMGQ5zd8sFuIgUwgc7y24k2CBdou/3nrk0QC0+n5O26YxsGOpPY8858LAYufcvw2o06CA5kuevoo1MTBkOc3fLBbiIFMIHO8tuJNggXaLv9565NEAtPp+TtumMbBjqT2PPOfCwGLn3L8NqNOggOZLnr6KNTEwZDnN3ywW4iBTCBzvLbiTYIF2i7/eeuTRALT6fk7bpjGwY6k9jzznwsBi59y/DajToIDmS56+ijUxMGQ5zd8sFuIgUwgc7y24k2CBdou/3nrk0QC0+n5O26YxsGOpPY8858LAYufcvw2o06');
ringtone.loop = true;

// --- Persistence Functions for selectedUser ---
function saveSelectedUser() {
    if (selectedUser) {
        try {
            // Store just the essential data to restore the selection
            const userData = {
                id: selectedUser.id,
                dbId: selectedUser.dbId,
                username: selectedUser.username,
                category: selectedUser.category
            };
            sessionStorage.setItem('selectedUser', JSON.stringify(userData));
        } catch (err) {
            console.warn('Failed to save selected user:', err);
        }
    }
}

function restoreSelectedUser() {
    try {
        const saved = sessionStorage.getItem('selectedUser');
        if (saved) {
            const userData = JSON.parse(saved);
            const contact = allRegisteredUsers.find(u => u.id === userData.id);
            if (contact) {
                selectContact(contact, false, null);
                return true;
            }
        }
    } catch (err) {
        console.warn('Failed to restore selected user:', err);
    }
    return false;
}

function ensureNotificationPermission() {
    requestNotificationPermission().catch(() => {});
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return Notification.permission === 'granted';
}

function getNotificationPreferenceKey(kind) {
    const userId = typeof user !== 'undefined' ? (user.dbId || user.id || 'guest') : 'guest';
    return `foreman-app:${userId}:notifications:${kind}`;
}

function isNotificationEnabled(kind) {
    if (!kind || !(kind in notificationPreferenceDefaults)) return true;
    const saved = localStorage.getItem(getNotificationPreferenceKey(kind));
    if (saved === null) return notificationPreferenceDefaults[kind];
    return saved === 'true';
}

function isAppInUse() {
    return document.visibilityState === 'visible' && document.hasFocus();
}

async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    try {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    } catch (err) {
        console.warn('Notification permission request failed:', err);
        return false;
    }
}

async function registerNotificationServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    if (notificationWorkerRegistration) return notificationWorkerRegistration;

    try {
        notificationWorkerRegistration = await navigator.serviceWorker.register('/sw.js');
        return notificationWorkerRegistration;
    } catch (err) {
        console.warn('Failed to register notification service worker:', err);
        return null;
    }
}

async function showNotification(title, body, options = {}) {
    if (!('Notification' in window)) return;
    const kind = options.kind || 'messages';
    if (!isNotificationEnabled(kind)) return;

    const onlyWhenInactive = options.onlyWhenInactive !== false;
    if (onlyWhenInactive && isAppInUse()) return;

    const permissionGranted = await requestNotificationPermission();
    if (!permissionGranted) return;

    const payload = {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: options.tag || `${kind}-${Date.now()}`,
        renotify: !!options.renotify,
        requireInteraction: !!options.requireInteraction,
        data: {
            url: options.url || window.location.href,
            kind
        }
    };

    const registration = await registerNotificationServiceWorker();
    if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, payload);
        return;
    }

    new Notification(title, payload);
}

function formatVoiceDuration(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const mins = String(Math.floor(total / 60)).padStart(2, '0');
    const secs = String(total % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function getPreferredVoiceMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    const preferred = [
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus'
    ];
    return preferred.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function audioBufferToWavBlob(audioBuffer) {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const numSamples = audioBuffer.length;
    const bytesPerSample = 2;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const sample = audioBuffer.getChannelData(channel)[i] || 0;
            const clipped = Math.max(-1, Math.min(1, sample));
            const int16 = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
            view.setInt16(offset, int16, true);
            offset += 2;
        }
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

async function normalizeVoiceBlobToPortableDataUrl(blob) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
        return blobToDataUrl(blob);
    }

    const ctx = new AudioCtx();
    try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await new Promise((resolve, reject) => {
            const result = ctx.decodeAudioData(arrayBuffer, resolve, reject);
            if (result && typeof result.then === 'function') {
                result.then(resolve).catch(reject);
            }
        });
        const wavBlob = audioBufferToWavBlob(audioBuffer);
        return await blobToDataUrl(wavBlob);
    } catch (err) {
        console.warn('Voice format normalization failed, falling back to original:', err);
        return blobToDataUrl(blob);
    } finally {
        try { await ctx.close(); } catch (_) {}
    }
}

function detectMediaTypeFromDataUrl(value) {
    if (typeof value !== 'string' || !value.startsWith('data:')) return null;
    if (value.startsWith('data:image/')) return 'image';
    if (value.startsWith('data:video/')) return 'video';
    if (value.startsWith('data:audio/')) return 'audio';
    return null;
}

function isMobileLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function setActiveMobileTab(tabName) {
    const tabs = [
        { id: 'mobile-tab-contacts', name: 'contacts' },
        { id: 'mobile-tab-chat', name: 'chat' },
        { id: 'mobile-tab-calls', name: 'calls' },
        { id: 'mobile-tab-profile', name: 'profile' }
    ];
    tabs.forEach((tab) => {
        const el = document.getElementById(tab.id);
        if (!el) return;
        el.classList.toggle('active', tab.name === tabName);
    });
}

function openCallsPanel() {
    if (isMobileLayout()) {
        document.body.classList.remove('mobile-chat-open');
        document.body.classList.add('mobile-calls-open');
    }
    setActiveMobileTab('calls');
    renderRecentCallsList();
}

function renderRecentCallsList() {
    const list = document.getElementById('mobile-calls-list');
    if (!list) return;

    const rows = [];
    Object.keys(userConversations || {}).forEach((conversationKey) => {
        const convo = userConversations[conversationKey] || [];
        convo.forEach((msg) => {
            if (msg.type !== 'call-history' && msg.type !== 'missed-call') return;
            const idPart = msg.id && String(msg.id).includes('_') ? Number(String(msg.id).split('_')[1]) : NaN;
            const createdAt = Number.isFinite(idPart) ? idPart : Date.now();
            const contactId = msg.fromDbId || conversationKey;
            const contact = allRegisteredUsers.find(u => u.id === contactId);
            rows.push({
                contactId,
                contactName: contact?.username || msg.from || 'Unknown user',
                message: msg.message || 'Call activity',
                timestamp: msg.timestamp || '',
                createdAt,
                isMissed: msg.type === 'missed-call' || String(msg.message || '').toLowerCase().includes('missed')
            });
        });
    });

    rows.sort((a, b) => b.createdAt - a.createdAt);
    const recent = rows.slice(0, 40);

    if (recent.length === 0) {
        list.innerHTML = `
            <div class="empty-state" style="min-height: 30vh;">
                <div class="empty-state-icon">📞</div>
                <p>No recent calls yet</p>
            </div>
        `;
        return;
    }

    list.innerHTML = '';
    recent.forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'mobile-call-item';
        const icon = item.isMissed ? '📵' : '📞';
        const iconColor = item.isMissed ? 'var(--danger)' : 'var(--success)';
        row.innerHTML = `
            <div class="mobile-call-main">
                <div class="mobile-call-name"></div>
                <div class="mobile-call-meta"></div>
            </div>
            <div style="text-align:right; font-size:11px; color:var(--text-gray);">
                <div style="font-size:17px; color:${iconColor};">${icon}</div>
                <div>${item.timestamp}</div>
            </div>
        `;
        row.querySelector('.mobile-call-name').textContent = item.contactName;
        row.querySelector('.mobile-call-meta').textContent = item.message;
        row.addEventListener('click', () => {
            const contact = allRegisteredUsers.find(u => u.id === item.contactId);
            if (!contact) {
                alert('Could not open this contact.');
                return;
            }
            const isOnline = onlineUserIds.has(contact.id);
            const onlineUser = connectedUsers.find(u => u.dbId === contact.id);
            selectContact(contact, isOnline, onlineUser);
        });
        list.appendChild(row);
    });
}

function openProfilePanel() {
    setActiveMobileTab('profile');
    const currentProfile = allRegisteredUsers.find(u => u.id === user.dbId) || {
        id: user.dbId,
        username: user.username,
        category: user.category,
        location: user.location || '',
        isAvailableForJob: !!user.isAvailableForJob,
        needsForeman: !!user.needsForeman
    };
    showProfileModal(currentProfile);
}

function openMobileChat() {
    if (isMobileLayout()) {
        document.body.classList.remove('mobile-calls-open');
        document.body.classList.add('mobile-chat-open');
        setActiveMobileTab('chat');
    }
}

function closeMobileChat() {
    document.body.classList.remove('mobile-chat-open');
    document.body.classList.remove('mobile-calls-open');
    if (isMobileLayout()) {
        setActiveMobileTab('contacts');
    }
}

function isLocalOrPrivateHost(hostname) {
    if (!hostname) return true;
    const normalized = String(hostname).toLowerCase();
    if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') return true;
    if (normalized.startsWith('192.168.') || normalized.startsWith('10.') || normalized.startsWith('172.')) return true;
    return normalized.endsWith('.local') || normalized === '0.0.0.0';
}

function canUseCallMedia() {
    return window.isSecureContext || isLocalOrPrivateHost(window.location.hostname);
}

function getGeolocationFailureMessage(error) {
    if (!canUseCallMedia()) {
        return 'Location sharing needs HTTPS on phones and most browsers. Open the app on https://... or use localhost on this device.';
    }
    if (!error) return 'Could not get your location.';
    if (error.code === 1) return 'Location permission was denied. Allow location access for this site in your browser settings.';
    if (error.code === 2) return 'Location is unavailable right now. Check GPS/network and try again.';
    if (error.code === 3) return 'Location request timed out. Try again where GPS signal is better.';
    return `Could not get your location: ${error.message}`;
}

function requestCurrentPosition(onSuccess, onFinally) {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        if (typeof onFinally === 'function') onFinally();
        return;
    }
    if (!canUseCallMedia()) {
        alert('Location sharing needs HTTPS on this browser. Open the HTTPS link or use localhost on this device.');
        if (typeof onFinally === 'function') onFinally();
        return;
    }
    navigator.geolocation.getCurrentPosition(
        onSuccess,
        (error) => {
            alert(getGeolocationFailureMessage(error));
            if (typeof onFinally === 'function') onFinally();
        },
        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
        }
    );
}

function roundCoordinate(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

function applyLocationPrecision(lat, lng, precise) {
    if (precise) {
        return { lat, lng, label: 'Precise location' };
    }
    return {
        lat: roundCoordinate(lat, 3),
        lng: roundCoordinate(lng, 3),
        label: 'Approximate location'
    };
}

function promptLocationShareOptions() {
    const shareType = window.prompt(
        'Location share type:\n1 = Send current location\n2 = Share live location\nEnter 1 or 2:',
        '1'
    );
    if (shareType === null) return null;

    const normalizedType = String(shareType).trim();
    const isLive = normalizedType === '2';
    if (normalizedType !== '1' && normalizedType !== '2') {
        alert('Please enter 1 or 2 for location share type.');
        return null;
    }

    let durationMinutes = 0;
    if (isLive) {
        const durationInput = window.prompt(
            'Share live location for how long? (minutes: 15, 60, or 480)',
            '15'
        );
        if (durationInput === null) return null;
        const parsed = parseInt(durationInput, 10);
        if (![15, 60, 480].includes(parsed)) {
            alert('Please choose 15, 60, or 480 minutes.');
            return null;
        }
        durationMinutes = parsed;
    }

    const precise = window.confirm('Share precise location?\nPress OK for precise GPS or Cancel for approximate area.');

    return {
        isLive,
        durationMinutes,
        precise
    };
}

function getLiveLocationIntervalMs() {
    return 30000;
}

function beginSilentLocationTracking(timerKey, options, onPosition) {
    const startedAt = Date.now();
    const endsAt = startedAt + (options.durationMinutes * 60 * 1000);

    const trackOnce = () => {
        requestCurrentPosition((position) => {
            const adjusted = applyLocationPrecision(position.coords.latitude, position.coords.longitude, options.precise);
            if (typeof onPosition === 'function') {
                onPosition(adjusted);
            }
        });
    };

    const intervalId = setInterval(() => {
        if (Date.now() >= endsAt) {
            stopLiveLocationShare(timerKey);
            return;
        }
        trackOnce();
    }, getLiveLocationIntervalMs());

    const timeoutId = setTimeout(() => {
        stopLiveLocationShare(timerKey);
    }, options.durationMinutes * 60 * 1000);

    liveLocationTimers[timerKey] = { intervalId, timeoutId };
}

function stopLiveLocationShare(key) {
    if (liveLocationTimers[key]) {
        clearInterval(liveLocationTimers[key].intervalId);
        clearTimeout(liveLocationTimers[key].timeoutId);
        delete liveLocationTimers[key];
    }
}

function emitLocationMessageToRecipient(targetUser, payload) {
    const recipientDbId = targetUser.dbId || targetUser.id;
    const onlineUser = connectedUsers.find(u => String(u.dbId) === String(recipientDbId));
    const recipientSocketId = onlineUser ? onlineUser.id : null;

    if (recipientSocketId) {
        socket.emit('direct message', { ...payload, to: recipientSocketId, toDbId: recipientDbId });
    } else {
        queuePendingMessage(recipientDbId, payload);
        console.warn('Recipient is offline. Location update queued and will be delivered when they come online.');
    }
}

function pushLocationMessageToConversation(targetUser, payload) {
    const conversationKey = getConversationKey(targetUser.id || targetUser.dbId);
    if (!userConversations[conversationKey]) {
        userConversations[conversationKey] = [];
    }
    const localMsg = { ...payload, isOwn: true };
    userConversations[conversationKey].push(localMsg);
    displayMessage(localMsg);
}

function storeDroppedPin(pinData) {
    if (!pinData || !Number.isFinite(pinData.lat) || !Number.isFinite(pinData.lng)) return;
    lastDroppedPin = {
        lat: pinData.lat,
        lng: pinData.lng,
        savedAt: Date.now()
    };
}

function shareMapLocationOnce(precise = true) {
    requestCurrentPosition((position) => {
        const adjusted = applyLocationPrecision(position.coords.latitude, position.coords.longitude, precise);
        const pinData = {
            lat: adjusted.lat,
            lng: adjusted.lng,
            user: user.username,
            category: user.category,
            fromDbId: user.dbId
        };
        socket.emit('drop pin', pinData);
        if (map) {
            map.setCenter({ lat: pinData.lat, lng: pinData.lng });
            addPinToMap(pinData);
        }
        storeDroppedPin(pinData);
    });
}

function startLiveMapLocation(options) {
    const timerKey = 'map_live_share';
    stopLiveLocationShare(timerKey);
    shareMapLocationOnce(options.precise);

    // Track updates silently without repeatedly sharing to chat.
    beginSilentLocationTracking(timerKey, options, (adjusted) => {
        storeDroppedPin({ lat: adjusted.lat, lng: adjusted.lng });
        localStorage.setItem('foreman-live-track-last', JSON.stringify({
            lat: adjusted.lat,
            lng: adjusted.lng,
            timestamp: Date.now()
        }));
    });
}

function closeLocationShareModal() {
    const modal = document.getElementById('location-share-modal');
    if (modal) modal.classList.remove('open');
}

function openLocationShareModal(context = 'chat') {
    const modal = document.getElementById('location-share-modal');
    const subtitle = document.getElementById('location-share-subtitle');
    if (!modal) return;

    locationShareContext = context;
    selectedLiveDurationMinutes = 15;

    document.querySelectorAll('.location-duration-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.minutes === '15');
    });

    if (subtitle) {
        subtitle.textContent = context === 'chat'
            ? `Share your location with ${selectedUser?.username || 'this contact'}.`
            : 'Share your location on the map.';
    }

    modal.classList.add('open');
}

function getLocationShareOptionsFromModal(isLive) {
    const preciseToggle = document.getElementById('location-precise-toggle');
    return {
        isLive,
        durationMinutes: isLive ? selectedLiveDurationMinutes : 0,
        precise: preciseToggle ? !!preciseToggle.checked : true
    };
}

function initLocationShareModal() {
    const modal = document.getElementById('location-share-modal');
    const closeBtn = document.getElementById('location-share-close-btn');
    const nowBtn = document.getElementById('location-share-now-btn');
    const liveBtn = document.getElementById('location-share-live-btn');
    if (!modal || !closeBtn || !nowBtn || !liveBtn) return;

    closeBtn.addEventListener('click', closeLocationShareModal);

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeLocationShareModal();
    });

    document.querySelectorAll('.location-duration-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedLiveDurationMinutes = parseInt(btn.dataset.minutes || '15', 10);
            document.querySelectorAll('.location-duration-btn').forEach(x => x.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    nowBtn.addEventListener('click', () => {
        const options = getLocationShareOptionsFromModal(false);
        if (locationShareContext === 'chat') {
            if (!selectedUser) {
                alert('Please select a contact first');
                return;
            }
            sendSingleChatLocation(selectedUser, options);
        } else {
            shareMapLocationOnce(options.precise);
        }
        closeLocationShareModal();
    });

    liveBtn.addEventListener('click', () => {
        const options = getLocationShareOptionsFromModal(true);
        if (locationShareContext === 'chat') {
            if (!selectedUser) {
                alert('Please select a contact first');
                return;
            }
            startLiveChatLocation(selectedUser, options);
        } else {
            startLiveMapLocation(options);
        }
        closeLocationShareModal();
    });
}

function sendDroppedPinToChat(targetUser, precise = true) {
    if (!targetUser) {
        alert('Please select a contact first.');
        return;
    }
    if (!lastDroppedPin) {
        alert('Drop a pin on the map first, then share it in chat.');
        return;
    }

    const adjusted = applyLocationPrecision(lastDroppedPin.lat, lastDroppedPin.lng, precise);
    const locationUrl = `https://www.google.com/maps?q=${adjusted.lat},${adjusted.lng}`;
    const locationMessage = `📌 Dropped pin (${adjusted.label.toLowerCase()}): ${adjusted.lat.toFixed(6)}, ${adjusted.lng.toFixed(6)}`;
    const msgData = {
        id: `pin_loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'location',
        from: user.username,
        fromDbId: user.dbId,
        to: targetUser.id || targetUser.dbId,
        message: locationMessage,
        locationUrl,
        lat: adjusted.lat,
        lng: adjusted.lng,
        timestamp: new Date().toLocaleTimeString(),
        isPrecise: precise,
        isLiveLocation: false,
        isDroppedPin: true
    };

    emitLocationMessageToRecipient(targetUser, msgData);
    pushLocationMessageToConversation(targetUser, msgData);
}

function sendSingleChatLocation(targetUser, options) {
    requestCurrentPosition((position) => {
        const adjusted = applyLocationPrecision(position.coords.latitude, position.coords.longitude, options.precise);
        const locationUrl = `https://www.google.com/maps?q=${adjusted.lat},${adjusted.lng}`;
        const locationMessage = `📍 ${adjusted.label}: ${adjusted.lat.toFixed(6)}, ${adjusted.lng.toFixed(6)}`;
        const msgData = {
            id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'location',
            from: user.username,
            fromDbId: user.dbId,
            to: targetUser.id || targetUser.dbId,
            message: locationMessage,
            locationUrl,
            lat: adjusted.lat,
            lng: adjusted.lng,
            timestamp: new Date().toLocaleTimeString(),
            isPrecise: options.precise,
            isLiveLocation: false
        };

        emitLocationMessageToRecipient(targetUser, msgData);
        pushLocationMessageToConversation(targetUser, msgData);

        const pinData = {
            lat: adjusted.lat,
            lng: adjusted.lng,
            user: user.username,
            category: user.category,
            fromDbId: user.dbId
        };
        socket.emit('drop pin', pinData);
        if (map) addPinToMap(pinData);
    });
}

function startLiveChatLocation(targetUser, options, onFinally) {
    const recipientDbId = targetUser.id || targetUser.dbId;
    const timerKey = `chat_${recipientDbId}`;
    stopLiveLocationShare(timerKey);

    const startedAt = Date.now();
    const endsAt = startedAt + (options.durationMinutes * 60 * 1000);

    const sendUpdate = () => {
        requestCurrentPosition((position) => {
            const adjusted = applyLocationPrecision(position.coords.latitude, position.coords.longitude, options.precise);
            const locationUrl = `https://www.google.com/maps?q=${adjusted.lat},${adjusted.lng}`;
            const locationMessage = `📡 Live ${adjusted.label.toLowerCase()} started: ${adjusted.lat.toFixed(6)}, ${adjusted.lng.toFixed(6)}`;
            const msgData = {
                id: `live_loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                type: 'location',
                from: user.username,
                fromDbId: user.dbId,
                to: recipientDbId,
                message: locationMessage,
                locationUrl,
                lat: adjusted.lat,
                lng: adjusted.lng,
                timestamp: new Date().toLocaleTimeString(),
                isPrecise: options.precise,
                isLiveLocation: true,
                liveUntil: new Date(endsAt).toISOString()
            };

            emitLocationMessageToRecipient(targetUser, msgData);
            pushLocationMessageToConversation(targetUser, msgData);
        });
    };

    // Share once in chat, then keep tracking silently on-device.
    sendUpdate();

    beginSilentLocationTracking(timerKey, options, (adjusted) => {
        localStorage.setItem('foreman-live-track-last', JSON.stringify({
            lat: adjusted.lat,
            lng: adjusted.lng,
            timestamp: Date.now(),
            targetDbId: recipientDbId
        }));
    });

    setTimeout(() => {
        alert('Live location tracking ended.');
    }, options.durationMinutes * 60 * 1000);

    if (typeof onFinally === 'function') onFinally();
}

function attachMapSearchHandlers() {
    const searchInput = document.getElementById('map-search-input');
    const searchBtn = document.getElementById('map-search-btn');
    if (!searchInput || !searchBtn) return;

    const panToSearchResult = (result) => {
        if (!result || !result.geometry || !result.geometry.location) return;

        if (result.geometry.viewport) {
            map.fitBounds(result.geometry.viewport);
        } else {
            map.setCenter(result.geometry.location);
            map.setZoom(13);
        }

        if (mapSearchMarker) mapSearchMarker.setMap(null);
        mapSearchMarker = new google.maps.Marker({
            position: result.geometry.location,
            map,
            title: result.formatted_address || searchInput.value.trim() || 'Search result'
        });
    };

    if (!searchInput.dataset.autocompleteBound && google.maps.places && google.maps.places.Autocomplete) {
        mapSearchAutocomplete = new google.maps.places.Autocomplete(searchInput, {
            componentRestrictions: { country: 'ng' },
            fields: ['formatted_address', 'geometry', 'name'],
            strictBounds: false,
            types: ['geocode']
        });

        mapSearchAutocomplete.addListener('place_changed', () => {
            const place = mapSearchAutocomplete.getPlace();
            if (!place || !place.geometry) return;
            panToSearchResult({
                geometry: place.geometry,
                formatted_address: place.formatted_address || place.name
            });
        });

        searchInput.dataset.autocompleteBound = '1';
    }

    const geocoder = new google.maps.Geocoder();

    const searchNigeriaWithOsm = async (query) => {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ng&limit=5&q=${encodeURIComponent(query)}`;
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/json'
                }
            });
            if (!response.ok) return null;
            const rows = await response.json();
            if (!Array.isArray(rows) || !rows.length) return null;

            const top = rows[0];
            const lat = Number(top.lat);
            const lng = Number(top.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

            return {
                geometry: {
                    location: new google.maps.LatLng(lat, lng)
                },
                formatted_address: top.display_name || query
            };
        } catch (err) {
            console.warn('OSM fallback search failed:', err);
            return null;
        }
    };

    const geocodeWithRequest = (request) => new Promise((resolve) => {
        geocoder.geocode(request, (results, status) => {
            resolve({ results, status });
        });
    });

    const searchNigeriaFirst = async (query) => {
        const nigeriaBounds = new google.maps.LatLngBounds(
            new google.maps.LatLng(4.2, 2.6),
            new google.maps.LatLng(13.9, 14.8)
        );

        const attempts = [
            {
                address: query,
                region: 'ng',
                componentRestrictions: { country: 'NG' },
                bounds: nigeriaBounds
            },
            {
                address: `${query}, Nigeria`,
                region: 'ng',
                componentRestrictions: { country: 'NG' },
                bounds: nigeriaBounds
            },
            {
                address: query,
                region: 'ng'
            }
        ];

        for (const request of attempts) {
            const { results, status } = await geocodeWithRequest(request);
            if (status === 'OK' && results && results.length) {
                return results[0];
            }
        }

        return null;
    };

    const runSearch = async () => {
        if (!map || typeof google === 'undefined' || !google.maps || !google.maps.Geocoder) {
            alert('Map search is not available right now.');
            return;
        }
        const query = searchInput.value.trim();
        if (!query) {
            alert('Enter an area or address to search.');
            return;
        }

        let result = await searchNigeriaFirst(query);
        if (!result) {
            result = await searchNigeriaWithOsm(`${query}, Nigeria`);
        }
        if (!result) {
            alert('Area not found. Try including a nearby city or state in Nigeria, e.g. "Gwarinpa Abuja" or "Sango Ota Ogun".');
            return;
        }

        panToSearchResult(result);
    };

    if (!searchBtn.dataset.bound) {
        searchBtn.addEventListener('click', runSearch);
        searchBtn.dataset.bound = '1';
    }
    if (!searchInput.dataset.bound) {
        searchInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                runSearch();
            }
        });
        searchInput.dataset.bound = '1';
    }
}

function snippetFromMessage(msg) {
    if (!msg) return '';
    if (msg.type === 'media') return msg.caption ? msg.caption : `[${msg.mediaType || 'media'}]`;
    if (msg.type === 'location') return 'Location shared';
    return String(msg.message || '').slice(0, 120);
}

function setReplyTarget(msg) {
    if (!msg || !msg.id) return;
    replyingTo = {
        id: msg.id,
        username: msg.isOwn ? 'You' : (msg.username || msg.from || 'Unknown'),
        message: snippetFromMessage(msg)
    };
    const preview = document.getElementById('reply-preview');
    const previewText = document.getElementById('reply-preview-text');
    if (preview && previewText) {
        previewText.textContent = `Replying to ${replyingTo.username}: ${replyingTo.message}`;
        preview.style.display = 'flex';
    }
}

function clearReplyTarget() {
    replyingTo = null;
    const preview = document.getElementById('reply-preview');
    if (preview) preview.style.display = 'none';
}

function renderReplyQuote(replyTo) {
    if (!replyTo) return '';
    const name = String(replyTo.username || 'User');
    const text = String(replyTo.message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="reply-quote"><strong>${name}</strong><div>${text}</div></div>`;
}

function getWorkStatusLabel(contactUser) {
    if (!contactUser) return '';
    if (contactUser.category === 'foreman') {
        return contactUser.isAvailableForJob ? 'Available for job' : 'Not available for job';
    }
    return contactUser.needsForeman ? 'Needs foreman' : 'Not currently hiring';
}

function getWorkStatusColor(contactUser) {
    if (!contactUser) return '#7f8c8d';
    if (contactUser.category === 'foreman') {
        return contactUser.isAvailableForJob ? '#27ae60' : '#e74c3c';
    }
    return contactUser.needsForeman ? '#f39c12' : '#7f8c8d';
}

function getForemanAvailabilityLabel(contactUser) {
    if (!contactUser || contactUser.category !== 'foreman') return '';
    return contactUser.isAvailableForJob ? 'Available' : 'Not available';
}

function buildContactSubtitle(contactUser) {
    if (!contactUser) return '';
    if (contactUser.category === 'foreman') {
        const availability = getForemanAvailabilityLabel(contactUser);
        return `${buildForemanRoleTitle(contactUser)} • ${availability}`;
    }
    return '🏗️ Contractor';
}

function refreshSelectedContactHeader() {
    if (!selectedUser || isGroupSelected()) return;

    const selectedDbId = selectedUser.dbId || selectedUser.id;
    if (!selectedDbId) return;

    const latestContact = allRegisteredUsers.find(u => String(u.id) === String(selectedDbId));
    if (latestContact) {
        selectedUser = normalizeDirectSelection({ ...selectedUser, ...latestContact });
    }

    const role = document.getElementById('chat-contact-role');
    if (role) role.textContent = buildContactSubtitle(selectedUser);
}

function formatJobsDoneLabel(total) {
    const count = Number.isFinite(total) ? Math.max(0, total) : 0;
    return `${count} job${count === 1 ? '' : 's'} done`;
}

function buildForemanRoleTitle(contactUser) {
    if (!contactUser || contactUser.category !== 'foreman') {
        return '🏗️ Contractor';
    }

    const foremanId = String(contactUser.id || contactUser.dbId || '');
    const stats = foremanStatsCache[foremanId];
    const base = '👷 Foreman';

    if (!stats || stats.loading) {
        return `${base} • loading stats...`;
    }

    const jobsLabel = formatJobsDoneLabel(stats.jobsDone);
    const ratingLabel = stats.hasRating ? `⭐ ${stats.averageRating.toFixed(1)}` : '⭐ No rating yet';
    return `${base} • ${jobsLabel} • ${ratingLabel}`;
}

async function ensureForemanStatsLoaded(foremanId) {
    const key = String(foremanId || '');
    if (!key) return;

    const existing = foremanStatsCache[key];
    if (existing && (existing.loading || Number.isFinite(existing.jobsDone))) {
        return;
    }

    foremanStatsCache[key] = {
        jobsDone: 0,
        averageRating: 0,
        hasRating: false,
        loading: true
    };

    try {
        const response = await fetch(`/api/reviews/${key}`);
        const data = await response.json();
        const total = Number.isFinite(data?.total) ? data.total : 0;
        const avg = parseFloat(data?.averageRating);
        const hasRating = Number.isFinite(avg) && total > 0;
        foremanStatsCache[key] = {
            jobsDone: Math.max(0, total),
            averageRating: hasRating ? avg : 0,
            hasRating,
            loading: false
        };
    } catch (err) {
        console.warn('Failed to load foreman stats:', err);
        foremanStatsCache[key] = {
            jobsDone: 0,
            averageRating: 0,
            hasRating: false,
            loading: false
        };
    }

    renderContactsList();

    if (selectedUser && String(selectedUser.id || selectedUser.dbId) === key) {
        refreshSelectedContactHeader();
    }
}

async function updateWorkStatusSwitch(enabled) {
    try {
        const payload = {
            sessionId,
            isAvailableForJob: user.category === 'foreman' ? enabled : false,
            needsForeman: user.category === 'contractor' ? enabled : false
        };

        const response = await fetch('/api/update-work-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to update status');
        }

        if (user.category === 'foreman') {
            user.isAvailableForJob = !!enabled;
        } else {
            user.needsForeman = !!enabled;
        }

        const me = allRegisteredUsers.find(u => u.id === user.dbId);
        if (me) {
            me.isAvailableForJob = user.isAvailableForJob;
            me.needsForeman = user.needsForeman;
        }
        renderContactsList();
    } catch (err) {
        console.error('Failed to update work status', err);
        alert('Could not update your work status. Please try again.');
        const toggle = document.getElementById('work-status-toggle');
        if (toggle) toggle.checked = !enabled;
    }
}

function initWorkStatusSwitch() {
    const labelEl = document.getElementById('work-status-label');
    const textEl = document.getElementById('work-status-text');
    const toggleEl = document.getElementById('work-status-toggle');
    if (!labelEl || !textEl || !toggleEl) return;

    if (user.category === 'foreman') {
        labelEl.textContent = 'Available for job';
        toggleEl.checked = !!user.isAvailableForJob;
        textEl.textContent = toggleEl.checked ? 'On' : 'Off';
    } else {
        labelEl.textContent = 'Need foreman';
        toggleEl.checked = !!user.needsForeman;
        textEl.textContent = toggleEl.checked ? 'On' : 'Off';
    }

    toggleEl.addEventListener('change', () => {
        textEl.textContent = toggleEl.checked ? 'On' : 'Off';
        updateWorkStatusSwitch(toggleEl.checked);
    });
}

// --- Chat Persistence Functions ---
function getConversationKey(target) {
    if (!target) return null;
    if (typeof target === 'object') {
        if (target.isGroup && target.groupId) return `group:${target.groupId}`;
        return target.dbId || target.id || null;
    }
    return target; // assume already a key
}

function normalizeDirectSelection(contactUser) {
    if (!contactUser) return null;
    const dbId = contactUser.dbId || contactUser.id;
    const live = connectedUsers.find(u => String(u.dbId) === String(dbId));
    return {
        ...contactUser,
        id: dbId,
        dbId,
        socketId: live ? (live.id || live.socketId || null) : (contactUser.socketId || null),
        peerId: live ? (live.peerId || null) : (contactUser.peerId || null),
        online: !!live
    };
}

function isGroupSelected() {
    return !!(selectedUser && selectedUser.isGroup);
}

function saveConversationToStorage(conversationKeyOverride = null) {
    try {
        const conversationKey = conversationKeyOverride || getConversationKey(selectedUser);
        if (!conversationKey) return;
        const storageKey = `chat_${user.dbId}_${conversationKey}`;
        if (userConversations[conversationKey]) {
            localStorage.setItem(storageKey, JSON.stringify(userConversations[conversationKey]));
        }
    } catch (err) {
        console.warn('Failed to save conversation:', err);
    }
}

function loadConversationFromStorage(userId) {
    try {
        const storageKey = `chat_${user.dbId}_${userId}`;
        const saved = localStorage.getItem(storageKey);
        return saved ? JSON.parse(saved) : [];
    } catch (err) {
        console.warn('Failed to load conversation:', err);
        return [];
    }
}

// Load all conversations on startup
function loadAllConversationsFromStorage() {
    try {
        const prefix = `chat_${user.dbId}_`;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                const userId = key.replace(prefix, '');
                userConversations[userId] = JSON.parse(localStorage.getItem(key)) || [];
            }
        }
        console.log(`✓ Loaded saved conversations from storage`);
    } catch (err) {
        console.warn('Failed to load conversations from storage:', err);
    }
}

function saveOutboxToStorage() {
    try {
        localStorage.setItem(`outbox_${user.dbId}`, JSON.stringify(pendingOutbox));
    } catch (err) {
        console.warn('Failed to save outbox:', err);
    }
}

function loadOutboxFromStorage() {
    try {
        const raw = localStorage.getItem(`outbox_${user.dbId}`);
        pendingOutbox = raw ? JSON.parse(raw) : {};
    } catch (err) {
        console.warn('Failed to load outbox:', err);
        pendingOutbox = {};
    }
}

function getSocketIdForUser(targetUser) {
    if (!targetUser) return null;
    if (targetUser.socketId) return targetUser.socketId;
    const dbId = targetUser.dbId || targetUser.id;
    if (!dbId) return null;
    const online = connectedUsers.find(u =>
        String(u.dbId) === String(dbId) || String(u.id) === String(dbId) || String(u.socketId) === String(dbId)
    );
    return online ? (online.id || online.socketId || null) : null;
}

function queuePendingMessage(dbId, payload) {
    if (!dbId || !payload) return;
    if (!pendingOutbox[dbId]) pendingOutbox[dbId] = [];
    pendingOutbox[dbId].push(payload);
    saveOutboxToStorage();
}

function deliverPendingMessagesForUser(dbId) {
    if (!dbId) return;
    const socketId = getSocketIdForUser({ dbId });
    if (!socketId || !pendingOutbox[dbId] || pendingOutbox[dbId].length === 0) return;
    pendingOutbox[dbId].forEach(msg => {
        socket.emit('direct message', { ...msg, to: socketId });
    });
    pendingOutbox[dbId] = [];
    saveOutboxToStorage();
}

function deliverAllPendingMessages() {
    Object.keys(pendingOutbox || {}).forEach(dbId => deliverPendingMessagesForUser(dbId));
}


// Bootstrap contacts from server-rendered data so the list appears immediately
if (Array.isArray(window.__BOOTSTRAP_USERS__) && window.__BOOTSTRAP_USERS__.length) {
    allRegisteredUsers = window.__BOOTSTRAP_USERS__;
    renderContactsList();
    const count = document.getElementById('user-count');
    if (count) count.textContent = Math.max(0, allRegisteredUsers.length - 1);
}

// Load all registered users from API
async function loadAllUsers() { 
    try {
        const response = await fetch('/api/all-users');
        const data = await response.json();
        allRegisteredUsers = Array.isArray(data.users) ? data.users.filter(Boolean) : [];
        console.log(`Loaded ${allRegisteredUsers.length} registered users`);
        renderContactsList();
        // Update header count (excluding self)
        const count = document.getElementById('user-count');
        if (count) count.textContent = Math.max(0, allRegisteredUsers.length - 1);
    } catch (err) {
        console.error('Failed to load all users:', err);
        const list = document.getElementById('contacts-list');
        if (list) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">⚠️</div>
                    <p>Could not load contacts. Check your connection and reload.</p>
                </div>
            `;
        }
    }
}

async function loadGroups() {
    try {
        const response = await fetch(`/api/groups?sessionId=${encodeURIComponent(sessionId)}`);
        const data = await response.json();
        groups = Array.isArray(data.groups) ? data.groups : [];
        renderGroupsList();
    } catch (err) {
        console.warn('Failed to load groups:', err);
    }
}

function renderGroupsList() {
    const list = document.getElementById('groups-list');
    if (!list) return;
    list.innerHTML = '';

    if (!groups.length) {
        list.innerHTML = '<div class="group-empty">No groups yet</div>';
        return;
    }

    groups.forEach((group) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'group-item';
        const isActive = selectedUser && selectedUser.isGroup && selectedUser.groupId === group.id;
        if (isActive) item.classList.add('active');
        const memberCount = Array.isArray(group.members) ? group.members.length : 0;
        item.innerHTML = `<span class="group-item-name"># ${group.name}</span><span class="group-item-meta">${memberCount} members</span>`;
        item.addEventListener('click', () => selectGroup(group));
        list.appendChild(item);
    });
}

function selectGroup(group) {
    if (!group || !group.id) return;
    selectedGroup = group;
    selectedUser = {
        isGroup: true,
        groupId: group.id,
        id: `group:${group.id}`,
        dbId: null,
        username: group.name,
        members: group.members || []
    };

    const avatar = document.getElementById('chat-avatar');
    const name = document.getElementById('chat-contact-name');
    const role = document.getElementById('chat-contact-role');
    const locationEl = document.getElementById('chat-user-location');
    const profileBtn = document.getElementById('view-profile-btn');
    const input = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-btn');
    const mediaButton = document.getElementById('media-btn');
    const voiceButton = document.getElementById('voice-note-btn');
    const locationButton = document.getElementById('location-share-btn');
    const callButton = document.getElementById('call-btn');
    const videoButton = document.getElementById('video-btn');

    if (avatar) {
        avatar.textContent = '#';
        avatar.className = 'contact-avatar contractor';
    }
    if (name) name.textContent = group.name;
    if (role) role.textContent = `Group chat • ${(group.members || []).length} members`;
    if (locationEl) locationEl.style.display = 'none';
    if (profileBtn) profileBtn.style.display = 'none';

    if (input) {
        input.placeholder = `Message #${group.name}`;
        input.disabled = false;
    }
    if (sendButton) sendButton.disabled = false;
    if (mediaButton) mediaButton.disabled = false;
    if (voiceButton) voiceButton.disabled = false;
    if (locationButton) locationButton.disabled = true;
    if (callButton) callButton.disabled = true;
    if (videoButton) videoButton.disabled = true;

    clearReplyTarget();
    loadConversation(getConversationKey(selectedUser));
    openMobileChat();
    renderGroupsList();
    renderContactsList();
}

function createGroupFromSelection() {
    const available = allRegisteredUsers.filter(u => String(u.id) !== String(user.dbId));
    if (!available.length) {
        alert('No users available to add to a group.');
        return;
    }
    const name = window.prompt('Enter group name:');
    if (!name || !name.trim()) return;
    const membersRaw = window.prompt('Enter usernames separated by commas (example: alice,bob):');
    if (membersRaw === null) return;

    const usernames = membersRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const selectedMembers = available
        .filter(u => usernames.includes(String(u.username || '').toLowerCase()))
        .map(u => u.id);

    socket.emit('create group', {
        name: name.trim(),
        members: selectedMembers
    }, (ack) => {
        if (!ack || !ack.success) {
            alert((ack && ack.error) || 'Could not create group.');
            return;
        }
        loadGroups();
        if (ack.group) selectGroup(ack.group);
    });
}

// --- Google Maps/Earth Initialization ---
function initPeer() {
    console.log('Initializing PeerJS...');
    console.log('User object:', user);
    console.log('Peer library available:', typeof Peer !== 'undefined');

    if (peer && !peer.destroyed) {
        try {
            peer.destroy();
        } catch (_) {}
    }
    
    try {
        const isSecure = window.location.protocol === 'https:';
        const baseConfig = {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    {
                        urls: 'turn:openrelay.metered.ca:80',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turns:openrelay.metered.ca:443',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ],
                iceTransportPolicy: 'all'
            },
            debug: 2
        };

        const localPeerConfig = {
            host: window.location.hostname,
            port: window.location.port ? Number(window.location.port) : (isSecure ? 443 : 80),
            path: '/peerjs',
            secure: isSecure,
            ...baseConfig
        };

        const cloudFallbackConfig = {
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
            ...baseConfig
        };

        let triedCloudFallback = false;

        const attachPeerEvents = () => {
            peer.on('open', (peerId) => {
                console.log('✓ Peer ID:', peerId);
                socket.emit('user join', {
                    username: user.username,
                    category: user.category,
                    id: user.dbId,
                    peerId: peerId,
                    sessionId: sessionId
                });
                updateCallButtonStates();
            });

            peer.on('call', (call) => {
                console.log('Incoming call received:', call);
                handleIncomingCall(call);
            });

            peer.on('disconnected', () => {
                console.warn('Peer disconnected. Attempting reconnect...');
                try {
                    peer.reconnect();
                } catch (_) {
                    setTimeout(() => initPeer(), 1200);
                }
            });

            peer.on('close', () => {
                console.warn('Peer connection closed. Reinitializing...');
                setTimeout(() => initPeer(), 1200);
            });

            peer.on('error', (err) => {
                console.error('Peer error:', err);
                const message = String(err?.message || err?.type || '').toLowerCase();
                const shouldTryFallback = !triedCloudFallback && (
                    message.includes('lost connection')
                    || message.includes('socket-closed')
                    || message.includes('server error')
                    || message.includes('network')
                    || message.includes('unavailable-id')
                );

                if (shouldTryFallback) {
                    triedCloudFallback = true;
                    try {
                        peer.destroy();
                    } catch (_) {}
                    console.warn('Switching PeerJS to cloud fallback...');
                    peer = new Peer(cloudFallbackConfig);
                    attachPeerEvents();
                }
            });
        };

        peer = new Peer(localPeerConfig);
        console.log('Trying local PeerJS server first:', localPeerConfig.host, localPeerConfig.port, localPeerConfig.path);
        attachPeerEvents();
        
        console.log('Peer object created:', peer);
    } catch (err) {
        console.error('Failed to initialize Peer:', err);
    }
}

function handleIncomingCall(call) {
    const incomingCallType = call?.metadata?.callType === 'video' ? 'video' : 'audio';
    const shouldUseVideo = incomingCallType === 'video';
    // Try to map incoming peerId to a known user so we can update UI
    if (!selectedUser || selectedUser.peerId !== call.peer) {
        const matched = connectedUsers.find(u => u.peerId === call.peer);
        if (matched) {
            const contact = allRegisteredUsers.find(u => String(u.id) === String(matched.dbId)) || {
                id: matched.dbId,
                username: matched.username,
                category: matched.category
            };
            selectedUser = normalizeDirectSelection(contact);
            renderContactsList();
            loadConversation(matched.dbId || matched.id);
        }
    }

    const callArea = document.getElementById('call-area');
    const callStatus = document.getElementById('call-status');
    const callerName = selectedUser?.username || 'Incoming call';
    if (callStatus) {
        callStatus.textContent = `${callerName} is ${shouldUseVideo ? 'video calling' : 'calling'}...`;
    }
    
    // Play ringtone
    ringtone.play().catch(err => console.log('Ringtone play failed:', err));
    
    // Show notification
    showNotification(`Incoming ${shouldUseVideo ? 'Video Call' : 'Call'}`, `${callerName} is calling...`, {
        kind: 'calls',
        tag: `incoming-call-${call.peer}`,
        renotify: true,
        requireInteraction: true
    });
    
    // Show call area with answer/decline buttons
    showCallOverlay(`${callerName} is calling...`);
    if (callStatus) {
        callStatus.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 18px; margin-bottom: 20px;">${callerName} is calling...</div>
                <div style="display: flex; gap: 20px; justify-content: center; flex-wrap: wrap;">
                    <button id="answer-call-btn" style="padding: 15px 24px; background: #27ae60; color: white; border: none; border-radius: 50px; cursor: pointer; font-size: 16px;">${shouldUseVideo ? '📹 Answer' : '📞 Answer'}</button>
                    <button id="decline-call-btn" style="padding: 15px 24px; background: #e74c3c; color: white; border: none; border-radius: 50px; cursor: pointer; font-size: 16px;">❌ Decline</button>
                </div>
            </div>
        `;
    }
    
    // Handle answer button
    document.getElementById('answer-call-btn')?.addEventListener('click', () => {
        ringtone.pause();
        ringtone.currentTime = 0;
        
        if (callStatus) callStatus.textContent = 'Connecting...';
        
        navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }, 
            video: shouldUseVideo ? { facingMode: 'user' } : false 
        })
            .then((stream) => {
                console.log('✓ Microphone access granted for answering');
                console.log('Local stream tracks:', stream.getTracks());
                console.log('Audio tracks:', stream.getAudioTracks());
                stream.getAudioTracks().forEach(track => {
                    console.log('Audio track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
                });
                
                localStream = stream;
                ensureLocalOutgoingAudio(stream);
                const localVideo = document.getElementById('local-video');
                const remoteVideo = document.getElementById('remote-video');
                
                // Show video only when this is a video call
                if (localVideo) {
                    localVideo.srcObject = stream;
                    localVideo.style.display = shouldUseVideo ? 'block' : 'none';
                    localVideo.muted = true; // Mute local audio to prevent echo
                }
                if (remoteVideo) {
                    remoteVideo.style.display = shouldUseVideo ? 'block' : 'none';
                }
                
                console.log('Answering call...');
                call.answer(stream);
                
                // Monitor connection state
                if (call.peerConnection) {
                    call.peerConnection.oniceconnectionstatechange = () => {
                        const state = call.peerConnection.iceConnectionState;
                        console.log('[ANSWER] ICE connection state:', state);
                        
                        if (state === 'disconnected') {
                            console.warn('[ANSWER] ICE disconnected, attempting to recover...');
                            if (callStatus) callStatus.textContent = 'Reconnecting...';
                        } else if (state === 'failed') {
                            console.error('[ANSWER] ICE connection failed');
                            if (callStatus) callStatus.textContent = 'Network unstable. Trying to reconnect...';
                        }
                    };
                    call.peerConnection.onconnectionstatechange = () => {
                        const state = call.peerConnection.connectionState;
                        console.log('[ANSWER] Connection state:', state);
                        
                        if (state === 'failed') {
                            console.error('[ANSWER] Connection failed');
                            if (callStatus) callStatus.textContent = 'Connection unstable. Waiting for recovery...';
                        }
                    };
                }
                
                // Set timeout for connection
                let remoteStreamReceived = false;
                const connectionTimeout = setTimeout(() => {
                    if (call && !remoteStreamReceived) {
                        console.error('Connection timeout - no remote stream received');
                        alert('Connection timeout. Please try again.');
                        endCall();
                    }
                }, 30000);
                
                call.on('stream', (remoteStream) => {
                    remoteStreamReceived = true;
                    clearTimeout(connectionTimeout);
                    console.log('✓ Remote stream received after answering');
                    console.log('Remote stream tracks:', remoteStream.getTracks());
                    console.log('Remote audio tracks:', remoteStream.getAudioTracks());
                    console.log('Remote stream active:', remoteStream.active);
                    remoteStream.getAudioTracks().forEach(track => {
                        console.log('Remote audio track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
                    });

                    attachRemoteCallStream(remoteStream, shouldUseVideo);
                    if (callStatus) callStatus.textContent = `Connected to ${callerName}`;
                    
                    // Add answered call to chat
                    addCallToChat('answered', callerName, selectedUser?.id || selectedUser?.dbId);
                });
                
                call.on('close', () => {
                    clearTimeout(connectionTimeout);
                    console.log('Call closed by remote peer');
                    endCall();
                });
                
                call.on('error', (err) => {
                    clearTimeout(connectionTimeout);
                    console.error('Call error:', err);
                    alert('Call error: ' + err.type);
                    endCall();
                });
                
                currentCall = call;
                console.log('✓ Call stored as currentCall');
            })
            .catch((err) => {
                console.error('Failed to get media:', err);
                alert('Failed to access microphone. Please allow microphone access and try again.');
                endCall();
            });
    });
    
    // Handle decline button
    document.getElementById('decline-call-btn')?.addEventListener('click', () => {
        ringtone.pause();
        ringtone.currentTime = 0;
        call.close();
        endCall();
        
        // Add declined call to chat
        addCallToChat('declined', callerName, selectedUser?.id);
    });
}

// --- Google Maps/Earth Initialization ---
function initMap() {
    const mapContainer = document.getElementById('google-earth-container');
    const mapLoading = document.getElementById('map-loading');
    
    // Hide loading message
    if (mapLoading) mapLoading.style.display = 'none';
    
    // Check if Google Maps API is loaded
    if (typeof google === 'undefined' || !google.maps) {
        console.warn('Google Maps API not loaded. Using fallback map.');
        createFallbackMap();
        return;
    }

    // Google Map initialization
    const mapOptions = {
        zoom: 6,
        center: { lat: 9.0820, lng: 8.6753 }, // Default to Nigeria
        mapTypeId: 'satellite', // Use satellite view for Earth-like appearance
        fullscreenControl: true,
        zoomControl: true,
        mapTypeControl: true,
        streetViewControl: true
    };

    try {
        map = new google.maps.Map(mapContainer, mapOptions);
        console.log("✓ Google Maps initialized successfully");
        if (mapLoading) mapLoading.style.display = 'none';
        addInitialMarkers();
        attachMapSearchHandlers();
    } catch (error) {
        console.error('Error initializing map:', error);
        if (mapLoading) {
            mapLoading.innerHTML = '<p style="color: #ff6b6b;">⚠️ Error loading map. Check your API key in .env file.</p>';
        }
        createFallbackMap();
    }
}

function createFallbackMap() {
    const mapContainer = document.getElementById('google-earth-container');
    mapContainer.style.backgroundColor = '#16213e';
    mapContainer.style.display = 'flex';
    mapContainer.style.flexDirection = 'column';
    mapContainer.style.justifyContent = 'center';
    mapContainer.style.alignItems = 'center';
    mapContainer.style.padding = '30px';
    mapContainer.style.textAlign = 'center';
    
    mapContainer.innerHTML = `
        <div style="max-width: 500px;">
            <h3 style="color: #667eea; margin-bottom: 15px;">🗺️ Map Preview Unavailable</h3>
            <p style="color: #a0a0a0; margin-bottom: 10px;">Google Earth integration is not configured for this deployment.</p>
            <div style="background: #1a1a2e; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; text-align: left; margin: 20px 0;">
                <p style="color: #ffffff; font-weight: bold; margin-bottom: 10px;">⚙️ Next step</p>
                <p style="color: #a0a0a0; line-height: 1.8; margin: 0;">Contact the administrator or configure the Google Earth API credentials to restore live map features.</p>
            </div>
        </div>
    `;
}

function addInitialMarkers() {
    if (!map) return;
    const places = [
        { lat: 40.7128, lng: -74.0060, title: 'New York', icon: 'blue' },
        { lat: 34.0522, lng: -118.2437, title: 'Los Angeles', icon: 'red' },
        { lat: 41.8781, lng: -87.6298, title: 'Chicago', icon: 'yellow' }
    ];
    places.forEach(place => {
        const iconUrl = `http://maps.google.com/mapfiles/ms/icons/${place.icon}-dot.png`;
        new google.maps.Marker({
            position: { lat: place.lat, lng: place.lng },
            map: map,
            title: place.title,
            icon: iconUrl,
            animation: google.maps.Animation.DROP
        });
    });
}

// --- Socket Events ---
socket.on('connect', () => {
    console.log('Connected to server');
    // Immediately announce presence so online status shows up even if PeerJS is slow
    socket.emit('user join', {
        username: user.username,
        category: user.category,
        id: user.dbId,
        peerId: null,
        sessionId: sessionId
    });
    loadAllConversationsFromStorage();
    loadOutboxFromStorage();
    initPeer();
    // Load all registered users on connect
    loadAllUsers();
    loadGroups();
    socket.emit('request groups', { dbId: user.dbId });
});

socket.on('user joined', (data) => {
    console.log('user joined event received:', data);
    connectedUsers = Array.isArray(data) ? data : (data?.users || []);
    console.log('connectedUsers array:', connectedUsers);
    
    // Update online user IDs and include peer IDs
    onlineUserIds = new Set(connectedUsers.map(u => u.dbId).filter(Boolean));
    // Update the selectedUser's peerId if they just came online
    if (selectedUser && !isGroupSelected() && connectedUsers.length > 0) {
        const updatedUser = connectedUsers.find(u => String(u.dbId) === String(selectedUser.dbId || selectedUser.id));
        if (updatedUser) {
            console.log('Updating selectedUser peerId from:', selectedUser.peerId, 'to:', updatedUser.peerId);
            selectedUser.peerId = updatedUser.peerId;
            selectedUser.socketId = updatedUser.id;
            selectedUser.online = true;
            // Update call button states
            updateCallButtonStates();
        }
    }
    refreshSelectedContactHeader();
    renderContactsList();
    const count = document.getElementById('user-count');
    if (count) count.textContent = Math.max(0, allRegisteredUsers.length - 1); // Show total registered users minus self
    // Try to flush queued messages to anyone who just came online
    Object.keys(pendingOutbox || {}).forEach(dbId => deliverPendingMessagesForUser(dbId));
});

socket.on('user left', (data) => {
    connectedUsers = Array.isArray(data) ? data : (data?.users || []);
    // Update online user IDs
    onlineUserIds = new Set(connectedUsers.map(u => u.dbId).filter(Boolean));
    // If selected user went offline, mark them offline
    if (selectedUser && !isGroupSelected() && !onlineUserIds.has(selectedUser.id)) {
        selectedUser.online = false;
    }
    refreshSelectedContactHeader();
    renderContactsList();
    const count = document.getElementById('user-count');
    if (count) count.textContent = Math.max(0, allRegisteredUsers.length - 1); // Show total registered users minus self
});

socket.on('work status updated', (data) => {
    if (!data || !data.userId) return;
    const userItem = allRegisteredUsers.find(u => u.id === data.userId);
    if (userItem) {
        userItem.isAvailableForJob = !!data.isAvailableForJob;
        userItem.needsForeman = !!data.needsForeman;
    }
    if (selectedUser && (selectedUser.id === data.userId || selectedUser.dbId === data.userId)) {
        selectedUser.isAvailableForJob = !!data.isAvailableForJob;
        selectedUser.needsForeman = !!data.needsForeman;
    }
    refreshSelectedContactHeader();
    renderContactsList();
});

socket.on('direct message', (data) => {
    console.log('=== DIRECT MESSAGE RECEIVED ===', data);
    console.log('Message type:', data.type);
    console.log('Location data:', { url: data.locationUrl, lat: data.lat, lng: data.lng });
    
    // If this is our own echoed message (delivery confirmation), update status
    if (data.fromSocketId === socket.id) {
        console.log('Own message echo - updating status');
        updateMessageStatus(data.id, 'delivered');
        return;
    }

    const conversationKey = data.fromDbId || data.fromSocketId;
    console.log('Conversation key:', conversationKey);
    
    if (!userConversations[conversationKey]) {
        userConversations[conversationKey] = [];
    }

    // Avoid duplicate insert if we already have this id
    const alreadyExists = userConversations[conversationKey].some(m => m.id === data.id);
    if (alreadyExists) {
        console.log('Message already exists, skipping');
        return;
    }

    const inferredMediaFromUrl = typeof data.message === 'string' && data.message.startsWith('data:');
    const normalizedType = data.type || ((data.isMedia || data.mediaType || inferredMediaFromUrl) ? 'media' : 'text');
    const resolvedMediaType = data.mediaType || detectMediaTypeFromDataUrl(data.message);

    const messagePayload = {
        id: data.id,
        username: data.username,
        message: data.message,
        caption: data.caption || null,
        replyTo: data.replyTo || null,
        fileName: data.fileName || null,
        mediaType: resolvedMediaType,
        timestamp: data.timestamp,
        isOwn: false,
        type: normalizedType,
        locationUrl: data.locationUrl || null,
        lat: data.lat || null,
        lng: data.lng || null
    };

    userConversations[conversationKey].push(messagePayload);
    console.log('Message added to conversation');
    console.log('selectedUser:', selectedUser);
    console.log('selectedUser.id:', selectedUser?.id);
    console.log('selectedUser.dbId:', selectedUser?.dbId);

    // Check if this message is from the currently selected user
    const isActiveChat = selectedUser && (
        selectedUser.id === conversationKey || 
        selectedUser.dbId === conversationKey ||
        selectedUser.id === data.fromDbId ||
        selectedUser.dbId === data.fromDbId
    );
    
    console.log('Is active chat:', isActiveChat);

    if (isActiveChat) {
        console.log('Displaying message in active chat');
        console.log('Message payload type:', messagePayload.type);
        if (data.isMedia || messagePayload.type === 'media' || messagePayload.mediaType) {
            displayMediaMessage(messagePayload);
        } else {
            displayMessage(messagePayload);
        }
    } else {
        console.log('Message not in active chat - incrementing unread');
        if (!unreadMessages[conversationKey]) {
            unreadMessages[conversationKey] = 0;
        }
        unreadMessages[conversationKey]++;
        renderContactsList();
    }
    
    showNotification(`New message from ${data.username}`, data.isMedia ? `[${(data.mediaType || '').toUpperCase()}]` : data.message, {
        kind: 'messages',
        tag: `message-${conversationKey}`,
        renotify: true
    });

    saveConversationToStorage(conversationKey);
});

socket.on('groups list', (payload) => {
    groups = Array.isArray(payload?.groups) ? payload.groups : [];
    renderGroupsList();
});

socket.on('group updated', (group) => {
    if (!group || !group.id) return;
    const idx = groups.findIndex(g => g.id === group.id);
    if (idx >= 0) {
        groups[idx] = group;
    } else {
        groups.push(group);
    }
    if (selectedUser && selectedUser.isGroup && selectedUser.groupId === group.id) {
        selectedUser.members = group.members || [];
        const role = document.getElementById('chat-contact-role');
        if (role) role.textContent = `Group chat • ${(group.members || []).length} members`;
    }
    renderGroupsList();
});

socket.on('group message', (data) => {
    if (!data || !data.groupId) return;
    const conversationKey = `group:${data.groupId}`;
    if (!userConversations[conversationKey]) {
        userConversations[conversationKey] = [];
    }
    const alreadyExists = userConversations[conversationKey].some(m => m.id === data.id);
    if (alreadyExists) return;

    const isOwn = String(data.fromDbId) === String(user.dbId);
    const msg = {
        id: data.id,
        username: data.username,
        message: data.message,
        caption: data.caption || null,
        replyTo: data.replyTo || null,
        fileName: data.fileName || null,
        mediaType: data.mediaType || detectMediaTypeFromDataUrl(data.message),
        timestamp: data.timestamp,
        isOwn,
        type: data.type || (data.mediaType ? 'media' : 'text')
    };

    userConversations[conversationKey].push(msg);
    saveConversationToStorage(conversationKey);

    const isActive = selectedUser && selectedUser.isGroup && selectedUser.groupId === data.groupId;
    if (isActive) {
        if (msg.type === 'media' || msg.mediaType) {
            displayMediaMessage(msg);
        } else {
            displayMessage(msg);
        }
    } else if (!isOwn) {
        showNotification(`New group message in ${data.groupName || 'Group'}`, `${data.username}: ${data.caption || data.message || 'sent a message'}`, {
            kind: 'messages',
            tag: `group-${data.groupId}`,
            renotify: true
        });
    }
});

socket.on('delete message', (data) => {
    if (!data || !data.messageId) return;
    removeMessageById(data.messageId);
});

socket.on('missed-call-notification', (data) => {
    console.log('Missed call notification received:', data);
    showNotification(`Missed Call from ${data.from}`, data.message || 'You have a missed call', {
        kind: 'calls',
        tag: `missed-call-${data.fromDbId || data.from}`,
        renotify: true,
        requireInteraction: true
    });
    
    // Add missed call to conversation
    const conversationKey = getConversationKey(data.fromDbId);
    if (!userConversations[conversationKey]) {
        userConversations[conversationKey] = [];
    }
    
    const missedCallMessage = {
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        from: data.from,
        fromDbId: data.fromDbId,
        to: user.username,
        toDbId: user.dbId,
        message: `📞 Missed call`,
        timestamp: data.timestamp || new Date().toLocaleTimeString(),
        type: 'missed-call'
    };
    
    userConversations[conversationKey].push(missedCallMessage);
    saveConversationToStorage(conversationKey);
    renderRecentCallsList();
    
    // Show in chat if this user is selected
    if (selectedUser && selectedUser.id === data.fromDbId) {
        displayMessage(missedCallMessage);
    } else {
        // Increment unread count
        unreadMessages[data.fromDbId] = (unreadMessages[data.fromDbId] || 0) + 1;
        renderContactsList();
    }
    
    // Optionally show an alert
    if (confirm(`${data.from} tried to call you while you were unavailable. View chat?`)) {
        // Find the user and select them
        const caller = allRegisteredUsers.find(u => u.id === data.fromDbId);
        if (caller) {
            const isOnline = onlineUserIds.has(caller.id);
            const onlineUser = connectedUsers.find(u => u.dbId === caller.id);
            selectContact(caller, isOnline, onlineUser);
        }
    }

    // Keep missed-call-notification logic separate from page initialization
});

socket.on('receive pin', (pinData) => {
    pins.push(pinData);
    addPinToMap(pinData);
    console.log('New pin received:', pinData);

    const isOwnPin = String(pinData.fromDbId || '') === String(user.dbId || '');
    if (!isOwnPin) {
        showNotification('New pin shared', `${pinData.user || 'A user'} dropped a location pin`, {
            kind: 'pins',
            tag: `pin-${pinData.fromDbId || pinData.user || Date.now()}`,
            renotify: true
        });
    }
});

socket.on('incoming call', (data) => {
    if (data.error && data.fromSocketId === socket.id) {
        alert('Call failed: recipient not connected.');
        return;
    }
    if (data.fromSocketId !== socket.id && !data.error) {
        const caller = data.from || 'Unknown';
        showNotification('Incoming call', `${caller} is calling you`, {
            kind: 'calls',
            tag: `incoming-call-${data.fromDbId || data.fromSocketId || data.from}`,
            renotify: true,
            requireInteraction: true
        });
        showCallOverlay(`${caller} is calling...`);
    }
});

socket.on('user typing', (data) => {
    if (!selectedUser || !data || !data.fromDbId) return;
    const selectedDbId = selectedUser.dbId || selectedUser.id;
    if (selectedDbId !== data.fromDbId) return;

    const indicator = document.getElementById('typing-indicator');
    if (!indicator) return;

    if (data.isTyping) {
        indicator.textContent = `${data.username} is typing...`;
        if (remoteTypingTimer) clearTimeout(remoteTypingTimer);
        remoteTypingTimer = setTimeout(() => {
            indicator.textContent = '';
        }, 1500);
    } else {
        indicator.textContent = '';
    }
});

// --- Render Functions ---
function renderContactsList() {
    const list = document.getElementById('contacts-list');
    if (!list) return;

    const normalizedQuery = (currentSearchQuery || '').trim().toLowerCase();
    const filteredUsers = allRegisteredUsers.filter(contactUser => {
        if (!normalizedQuery) return true;
        const role = contactUser.category === 'foreman' ? 'foreman' : 'contractor';
        const location = (contactUser.location || '').toLowerCase();
        const status = getWorkStatusLabel(contactUser).toLowerCase();
        const name = (contactUser.username || '').toLowerCase();
        return name.includes(normalizedQuery)
            || role.includes(normalizedQuery)
            || location.includes(normalizedQuery)
            || status.includes(normalizedQuery);
    });

    if (filteredUsers.length === 0 && groups.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <p>No contacts match your search</p>
            </div>
        `;
        return;
    }

    list.innerHTML = '';
    renderGroupsList();

    if (groups.length > 0 && !normalizedQuery) {
        const groupHeader = document.createElement('div');
        groupHeader.className = 'contact-group-header';
        groupHeader.textContent = 'DIRECT CONTACTS';
        list.appendChild(groupHeader);
    }

    // Show all registered users
    filteredUsers.forEach(contactUser => {
        if (!contactUser || !contactUser.id) return;
        const isOnline = onlineUserIds.has(contactUser.id);
        const onlineUser = connectedUsers.find(u => u.dbId === contactUser.id);
        const item = document.createElement('div');
        item.className = 'contact-item';
        if (selectedUser && selectedUser.id === contactUser.id) {
            item.classList.add('active');
        }
        
        const safeUsername = String(contactUser.username || 'Unknown');
        const initial = safeUsername.charAt(0).toUpperCase() || '?';
        const roleClass = contactUser.category === 'foreman' ? 'foreman' : 'contractor';
        const roleBadge = buildForemanRoleTitle(contactUser);
        const roleBadgeColor = contactUser.category === 'foreman' ? '#ffc107' : '#17a2b8';
        const isSelf = contactUser.id === user.dbId;
        const selfBadge = isSelf ? ' <span style="color: #27ae60; font-weight: 700;">(You)</span>' : '';
        const onlineStatus = isOnline ? '🟢' : '⚫';
        const statusText = isOnline ? 'Online' : 'Offline';
        const statusColor = isOnline ? '#27ae60' : '#7f8c8d';
        const workStatus = contactUser.category === 'foreman'
            ? `Availability: ${getForemanAvailabilityLabel(contactUser)}`
            : getWorkStatusLabel(contactUser);
        const workStatusColor = getWorkStatusColor(contactUser);
        const locationLabel = contactUser.location ? '📍 ' + contactUser.location : '📍 Location not set';
        
        const unreadCount = unreadMessages[contactUser.id] || 0;
        const unreadBadge = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : '';
        item.innerHTML = `
            <div class="contact-avatar ${roleClass}">${initial}</div>
            <div class="contact-info">
                <div class="contact-name">${safeUsername}${selfBadge}</div>
                <div class="contact-role" style="color: ${roleBadgeColor}; font-weight: 600; font-size: 11px;">${roleBadge}</div>
                <div class="contact-role" style="font-size: 11px; color: ${workStatusColor};">${workStatus}</div>
                <div class="contact-role" style="font-size: 11px;">${locationLabel}</div>
            </div>
            <div class="contact-status" style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                <span style="font-size: 10px;">${onlineStatus}</span>
                <span style="font-size: 9px; color: ${statusColor};">${statusText}</span>
            </div>
            ${unreadBadge}
        `;
        
        // Allow selecting anyone (show offline state when not available)
        if (!isSelf) {
            item.addEventListener('click', () => selectContact(contactUser, isOnline, onlineUser));
            if (!isOnline) {
                item.style.opacity = '0.6';
                item.title = `${contactUser.username} is offline`;
            }
        } else {
            item.style.opacity = '0.7';
            item.style.cursor = 'default';
        }

        if (contactUser.category === 'foreman') {
            ensureForemanStatsLoaded(contactUser.id || contactUser.dbId);
        }
        
        list.appendChild(item);
    });
}

function selectContact(contactUser, isOnline = false, onlineUser = null) {
    console.log('selectContact called with:', { contactUser, isOnline, onlineUser });
    selectedGroup = null;
    
    selectedUser = normalizeDirectSelection(contactUser);
    
    console.log('selectedUser after merge:', selectedUser);
    console.log('selectedUser.online:', selectedUser.online);
    console.log('selectedUser.peerId:', selectedUser.peerId);
    
    // Clear unread count when selecting this user
    unreadMessages[contactUser.id] = 0;
    
    // Update UI
    renderContactsList(); // Re-render to highlight selected
    
    const avatar = document.getElementById('chat-avatar');
    const name = document.getElementById('chat-contact-name');
    const role = document.getElementById('chat-contact-role');
    const locationEl = document.getElementById('chat-user-location');
    const locationText = document.getElementById('chat-user-location-text');
    const profileBtn = document.getElementById('view-profile-btn');
    const input = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-btn');
    const mediaButton = document.getElementById('media-btn');
    const voiceButton = document.getElementById('voice-note-btn');
    const locationButton = document.getElementById('location-share-btn');
    const callButton = document.getElementById('call-btn');
    const videoButton = document.getElementById('video-btn');
    
    if (avatar) {
        avatar.textContent = contactUser.username.charAt(0).toUpperCase();
        avatar.className = `contact-avatar ${contactUser.category}`;
    }
    if (name) name.textContent = contactUser.username;
    if (role) role.textContent = buildContactSubtitle(contactUser);
    if (contactUser.category === 'foreman') {
        ensureForemanStatsLoaded(contactUser.id || contactUser.dbId);
    }
    
    // Show location if available
    if (locationEl && locationText) {
        if (contactUser.location) {
            locationText.textContent = contactUser.location;
            locationEl.style.display = 'flex';
        } else {
            locationEl.style.display = 'none';
        }
    }
    
    // Show profile button
    if (profileBtn) {
        profileBtn.style.display = 'block';
    }
    
    if (input) {
        input.disabled = false;
        input.placeholder = selectedUser.online
            ? `Message ${contactUser.username}...`
            : `Message ${contactUser.username} (offline - will send when online)`;
    }
    if (sendButton) sendButton.disabled = false;
    if (mediaButton) mediaButton.disabled = false;
    if (voiceButton) {
        const supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof MediaRecorder !== 'undefined');
        voiceButton.disabled = !supported;
        voiceButton.title = supported ? 'Record Voice Note' : 'Voice note not supported on this browser';
    }
    if (locationButton) locationButton.disabled = false;
    if (callButton) callButton.disabled = false;
    if (videoButton) videoButton.disabled = false;
    openMobileChat();
    
    // Reset reply state when switching chats
    clearReplyTarget();

    // Load conversation history
    loadConversation(getConversationKey(selectedUser));
    
    // Save selected user for persistence
    saveSelectedUser();
}

function loadConversation(userId) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    const conversationKey = getConversationKey(userId);
    if (!conversationKey) return;
    
    // Load from storage if not in memory
    if (!userConversations[conversationKey]) {
        userConversations[conversationKey] = loadConversationFromStorage(conversationKey);
    }
    
    container.innerHTML = '';

    const conversation = userConversations[conversationKey] || [];
    if (conversation.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💬</div>
                <p>No messages yet. Start the conversation!</p>
            </div>
        `;
        return;
    }
    
    conversation.forEach(msg => {
        const hasDataUrl = typeof msg.message === 'string' && msg.message.startsWith('data:');
        if (msg.type === 'media' || msg.mediaType || hasDataUrl) {
            displayMediaMessage(msg);
        } else {
            displayMessage(msg);
        }
    });
}

function displayMessage(msg) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    
    // Remove empty state if present
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    const messageEl = document.createElement('div');

    const hasDataUrl = typeof msg.message === 'string' && msg.message.startsWith('data:');
    if ((msg.type === 'media' || msg.mediaType || hasDataUrl) && typeof displayMediaMessage === 'function') {
        displayMediaMessage(msg);
        return;
    }
    
    // Handle call history messages (missed, answered, declined, outgoing)
    if (msg.type === 'missed-call' || msg.type === 'call-history') {
        messageEl.className = 'message system-message';
        const color = msg.color || '#e74c3c';
        messageEl.style.cssText = `text-align: center; padding: 10px; margin: 10px 0; background: rgba(${hexToRgb(color)}, 0.1); border-radius: 8px; color: ${color};`;
        const timestamp = msg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageEl.innerHTML = `
            <div style="font-style: italic;">${msg.message}</div>
            <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">${timestamp}</div>
        `;
        container.appendChild(messageEl);
        container.scrollTop = container.scrollHeight;
        return;
    }
    
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '231, 76, 60';
}
    
    messageEl.className = `message ${msg.isOwn ? 'own' : 'other'}`;
    if (msg.id) messageEl.dataset.messageId = msg.id;
    
    const timestamp = msg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const statusIcon = msg.isOwn ? (msg.status === 'delivered' ? '✔✔' : '✔') : '';
    
    const replyHtml = renderReplyQuote(msg.replyTo);

    // Handle location messages
    if (msg.type === 'location' && msg.locationUrl) {
        console.log('Rendering location message:', msg);
        messageEl.innerHTML = `
            ${replyHtml}
            <div style="padding: 8px; background: rgba(46, 204, 113, 0.1); border-radius: 8px;">
                <div style="margin-bottom: 8px;">${msg.message}</div>
                <a href="${msg.locationUrl}" target="_blank" style="display: inline-block; padding: 8px 16px; background: var(--success); color: white; text-decoration: none; border-radius: 6px; font-size: 13px;">View on Google Maps</a>
            </div>
            <div class="message-meta">${msg.isOwn ? 'You' : (msg.username || msg.from)} • ${timestamp} ${statusIcon}</div>
        `;
    } else {
        messageEl.innerHTML = `
            ${replyHtml}
            <div>${msg.message}</div>
            <div class="message-meta">${msg.isOwn ? 'You' : msg.username} • ${timestamp} ${statusIcon}</div>
        `;
    }
    
    if (msg.id) addReplyButton(messageEl, msg);
    if (msg.isOwn && msg.id) addDeleteButton(messageEl, msg.id);
    attachSwipeReplyGesture(messageEl, msg);
    
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
}

function displayMediaMessage(msg) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    
    // Remove empty state if present
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    const messageEl = document.createElement('div');
    messageEl.className = `message ${msg.isOwn ? 'own' : 'other'}`;
    if (msg.id) messageEl.dataset.messageId = msg.id;
    
    const timestamp = msg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const statusIcon = msg.isOwn ? (msg.status === 'delivered' ? '✔✔' : '✔') : '';
    let mediaHtml = '';
    const resolvedMediaType = msg.mediaType || detectMediaTypeFromDataUrl(msg.message);
    
    if (resolvedMediaType === 'image') {
        mediaHtml = `<img src="${msg.message}" style="max-width: 200px; border-radius: 8px; margin-bottom: 8px;">`;
    } else if (resolvedMediaType === 'video') {
        mediaHtml = `<video src="${msg.message}" controls style="max-width: 200px; border-radius: 8px; margin-bottom: 8px;"></video>`;
    } else if (resolvedMediaType === 'audio') {
        mediaHtml = `<audio src="${msg.message}" controls style="width: 240px; max-width: 100%; margin-bottom: 8px;"></audio>`;
    } else if (resolvedMediaType === 'document') {
        const safeName = (msg.fileName || 'Document').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        mediaHtml = `<a href="${msg.message}" target="_blank" rel="noopener" download="${safeName}" style="display: inline-block; margin-bottom: 8px; color: #fff; text-decoration: none; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); padding: 10px 12px; border-radius: 10px;">📄 ${safeName}</a>`;
    } else {
        mediaHtml = `<a href="${msg.message}" target="_blank" rel="noopener" style="display: inline-block; margin-bottom: 8px; color: #fff; text-decoration: underline;">Open attachment</a>`;
    }
    const captionHtml = msg.caption ? `<div style="margin-bottom: 8px;">${msg.caption}</div>` : '';
    const replyHtml = renderReplyQuote(msg.replyTo);
    
    messageEl.innerHTML = `
        ${replyHtml}
        ${mediaHtml}
        ${captionHtml}
        <div class="message-meta">${msg.isOwn ? 'You' : msg.username} • ${timestamp} ${statusIcon}</div>
    `;
    
    if (msg.id) addReplyButton(messageEl, msg);
    if (msg.isOwn && msg.id) addDeleteButton(messageEl, msg.id);
    attachSwipeReplyGesture(messageEl, msg);
    
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
}

function attachSwipeReplyGesture(messageEl, msg) {
    if (!messageEl || !msg || !msg.id) return;

    let startX = 0;
    let startY = 0;
    let deltaX = 0;
    let tracking = false;

    const threshold = 64;
    const maxTranslate = 72;

    const reset = () => {
        tracking = false;
        deltaX = 0;
        messageEl.style.transition = 'transform 0.18s ease';
        messageEl.style.transform = 'translateX(0px)';
    };

    messageEl.addEventListener('touchstart', (event) => {
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        startX = touch.clientX;
        startY = touch.clientY;
        deltaX = 0;
        tracking = true;
        messageEl.style.transition = 'none';
    }, { passive: true });

    messageEl.addEventListener('touchmove', (event) => {
        if (!tracking) return;
        const touch = event.touches && event.touches[0];
        if (!touch) return;

        const moveX = touch.clientX - startX;
        const moveY = touch.clientY - startY;

        if (Math.abs(moveY) > Math.abs(moveX)) {
            return;
        }

        if (moveX <= 0) {
            messageEl.style.transform = 'translateX(0px)';
            deltaX = 0;
            return;
        }

        deltaX = Math.min(maxTranslate, moveX);
        messageEl.style.transform = `translateX(${deltaX}px)`;
    }, { passive: true });

    messageEl.addEventListener('touchend', () => {
        if (!tracking) return;
        const shouldReply = deltaX >= threshold;
        reset();
        if (shouldReply) {
            setReplyTarget(msg);
            if (navigator.vibrate) navigator.vibrate(18);
        }
    });

    messageEl.addEventListener('touchcancel', reset);
}

function addDeleteButton(messageEl, messageId) {
    const btn = document.createElement('button');
    btn.className = 'delete-btn';
    btn.textContent = 'Delete';
    btn.addEventListener('click', () => {
        if (!messageId || !selectedUser) return;
        const targetSocketId = getSocketIdForUser(selectedUser);
        if (targetSocketId) {
            socket.emit('delete message', { messageId, to: targetSocketId });
        }
        removeMessageById(messageId);
    });
    messageEl.appendChild(btn);
}

function addReplyButton(messageEl, msg) {
    const btn = document.createElement('button');
    btn.className = 'reply-btn';
    btn.textContent = 'Reply';
    btn.addEventListener('click', () => setReplyTarget(msg));
    messageEl.appendChild(btn);
}

function updateMessageStatus(messageId, status) {
    if (!messageId) return;
    Object.keys(userConversations).forEach(key => {
        const convo = userConversations[key];
        if (!Array.isArray(convo)) return;
        const idx = convo.findIndex(m => m.id === messageId);
        if (idx !== -1) {
            convo[idx].status = status;
            const isSelectedKey = getConversationKey(selectedUser) === key;
            if (isSelectedKey) {
                const el = document.querySelector(`[data-message-id="${messageId}"] .message-meta`);
                if (el) {
                    const meta = el.textContent.split('✔')[0].trim();
                    el.textContent = `${meta} ${status === 'delivered' ? '✔✔' : '✔'}`;
                }
            }
            saveConversationToStorage(key);
        }
    });
}

function removeMessageById(messageId) {
    if (!messageId) return;
    Object.keys(userConversations).forEach(key => {
        const convo = userConversations[key];
        if (!Array.isArray(convo)) return;
        const idx = convo.findIndex(m => m.id === messageId);
        if (idx !== -1) {
            convo.splice(idx, 1);
            const storageKey = getConversationKey(selectedUser);
            if (storageKey === key) {
                removeMessageElement(messageId);
            }
            saveConversationToStorage(key);
        }
    });
}

function removeMessageElement(messageId) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    const el = container.querySelector(`[data-message-id="${messageId}"]`);
    if (el) el.remove();
    if (!container.children.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💬</div>
                <p>No messages yet. Start the conversation!</p>
            </div>
        `;
    }
}

function closePlusMenu() {
    const menu = document.getElementById('chat-plus-menu');
    if (!menu) return;
    menu.classList.remove('open');
    plusMenuOpen = false;
}

function togglePlusMenu() {
    const menu = document.getElementById('chat-plus-menu');
    if (!menu) return;
    plusMenuOpen = !plusMenuOpen;
    menu.classList.toggle('open', plusMenuOpen);
}

// --- Event Handlers ---
document.getElementById('send-btn')?.addEventListener('click', sendMessage);
document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

document.getElementById('chat-input')?.addEventListener('input', () => {
    if (!selectedUser) return;
    if (isGroupSelected()) return;
    const toSocketId = getSocketIdForUser(selectedUser);
    if (!toSocketId) return;

    socket.emit('user typing', { toSocketId, isTyping: true });
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        socket.emit('user typing', { toSocketId, isTyping: false });
    }, 900);
});

// Location share in chat
document.getElementById('location-share-btn')?.addEventListener('click', () => {
    if (!selectedUser) {
        alert('Please select a contact first');
        return;
    }
    if (isGroupSelected()) {
        alert('Location share is currently available for direct chats only.');
        return;
    }

    openLocationShareModal('chat');
});

document.getElementById('reply-cancel-btn')?.addEventListener('click', () => {
    clearReplyTarget();
});

document.getElementById('chat-plus-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    togglePlusMenu();
});

document.getElementById('plus-media-btn')?.addEventListener('click', () => {
    closePlusMenu();
    document.getElementById('media-input')?.click();
});

document.getElementById('plus-document-btn')?.addEventListener('click', () => {
    closePlusMenu();
    document.getElementById('document-input')?.click();
});

document.getElementById('plus-location-btn')?.addEventListener('click', () => {
    closePlusMenu();
    if (!selectedUser) {
        alert('Please select a contact first');
        return;
    }
    if (isGroupSelected()) {
        alert('Location share is currently available for direct chats only.');
        return;
    }
    openLocationShareModal('chat');
});

document.getElementById('plus-voice-btn')?.addEventListener('click', () => {
    closePlusMenu();
    const voiceBtn = document.getElementById('voice-note-btn');
    if (!voiceBtn || voiceBtn.disabled) {
        alert('Voice note is not available right now.');
        return;
    }
    startVoiceRecording();
});

document.addEventListener('click', (event) => {
    const menu = document.getElementById('chat-plus-menu');
    const plusBtn = document.getElementById('chat-plus-btn');
    if (!menu || !plusBtn || !plusMenuOpen) return;
    if (menu.contains(event.target) || plusBtn.contains(event.target)) return;
    closePlusMenu();
});

function setVoiceRecordingMode(mode) {
    voiceRecordingMode = mode === 'tap' ? 'tap' : 'hold';
    const holdBtn = document.getElementById('voice-mode-hold');
    const tapBtn = document.getElementById('voice-mode-tap');
    holdBtn?.classList.toggle('active', voiceRecordingMode === 'hold');
    tapBtn?.classList.toggle('active', voiceRecordingMode === 'tap');
}

function updateVoiceRecordingUi() {
    const panel = document.getElementById('voice-recording-panel');
    const timer = document.getElementById('voice-recording-timer');
    const state = document.getElementById('voice-recording-state');
    const progressFill = document.getElementById('voice-recording-progress-fill');
    const pauseBtn = document.getElementById('voice-record-pause-btn');

    if (!panel || !timer || !state || !progressFill || !pauseBtn) return;

    panel.classList.toggle('open', isVoiceRecording);
    if (!isVoiceRecording) {
        timer.textContent = '00:00';
        state.textContent = voiceRecordingMode === 'hold' ? 'Hold mic button to record' : 'Tap mic button to record';
        progressFill.style.width = '0%';
        pauseBtn.textContent = 'Pause';
        return;
    }

    const elapsedMs = (voiceRecordingPausedAt || Date.now()) - voiceRecordingStartedAt;
    const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    timer.textContent = formatVoiceDuration(elapsedSeconds);

    const progress = Math.min(100, (elapsedSeconds / VOICE_RECORDING_MAX_SECONDS) * 100);
    progressFill.style.width = `${progress}%`;

    const isPaused = voiceMediaRecorder?.state === 'paused';
    state.textContent = isPaused ? 'Paused' : (voiceRecordingMode === 'hold' ? 'Recording (hold mode)' : 'Recording (tap mode)');
    pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';

    if (elapsedSeconds >= VOICE_RECORDING_MAX_SECONDS) {
        stopVoiceRecording({ intent: 'send' });
    }
}

function startVoiceRecordingTimer() {
    if (voiceRecordingTimer) clearInterval(voiceRecordingTimer);
    voiceRecordingTimer = setInterval(updateVoiceRecordingUi, 200);
    updateVoiceRecordingUi();
}

function stopVoiceRecordingTimer() {
    if (voiceRecordingTimer) {
        clearInterval(voiceRecordingTimer);
        voiceRecordingTimer = null;
    }
}

function resetVoiceRecordingUi() {
    const voiceBtn = document.getElementById('voice-note-btn');
    if (voiceBtn) {
        voiceBtn.textContent = '🎤';
        voiceBtn.classList.remove('recording-pulse');
    }
    voiceRecordingPausedAt = 0;
    stopVoiceRecordingTimer();
    updateVoiceRecordingUi();
}

async function startVoiceRecording() {
    if (!selectedUser) {
        alert('Please select a contact first');
        return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
        alert('Voice notes are not supported on this browser.');
        return;
    }
    if (isVoiceRecording) return;

    try {
        voiceStopIntent = 'preview';
        voiceRecordingStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        voiceRecordingStream.getAudioTracks().forEach((track) => {
            track.enabled = true;
        });
        voiceRecordingChunks = [];
        const preferredMimeType = getPreferredVoiceMimeType();
        voiceMediaRecorder = preferredMimeType
            ? new MediaRecorder(voiceRecordingStream, { mimeType: preferredMimeType })
            : new MediaRecorder(voiceRecordingStream);
        voiceRecordingStartedAt = Date.now();
        voiceRecordingPausedAt = 0;

        voiceMediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) voiceRecordingChunks.push(event.data);
        };

        voiceMediaRecorder.onpause = () => {
            voiceRecordingPausedAt = Date.now();
            updateVoiceRecordingUi();
        };

        voiceMediaRecorder.onresume = () => {
            if (voiceRecordingPausedAt) {
                const pausedDuration = Date.now() - voiceRecordingPausedAt;
                voiceRecordingStartedAt += pausedDuration;
                voiceRecordingPausedAt = 0;
            }
            updateVoiceRecordingUi();
        };

        voiceMediaRecorder.onstop = async () => {
            isVoiceRecording = false;
            voiceMediaRecorder = null;
            resetVoiceRecordingUi();

            if (voiceRecordingStream) {
                voiceRecordingStream.getTracks().forEach(track => track.stop());
                voiceRecordingStream = null;
            }

            const blobType = (voiceRecordingChunks[0] && voiceRecordingChunks[0].type) || 'audio/webm';
            const blob = new Blob(voiceRecordingChunks, { type: blobType });
            voiceRecordingChunks = [];
            if (!blob.size || !selectedUser || voiceStopIntent === 'discard') {
                voiceStopIntent = 'preview';
                return;
            }

            pendingVoiceBlob = blob;
            pendingVoicePreviewDuration = Math.max(0, ((voiceRecordingPausedAt || Date.now()) - voiceRecordingStartedAt) / 1000);
            if (pendingVoicePreviewUrl) {
                URL.revokeObjectURL(pendingVoicePreviewUrl);
                pendingVoicePreviewUrl = null;
            }

            try {
                pendingVoicePreviewData = await normalizeVoiceBlobToPortableDataUrl(blob);
                pendingVoicePreviewUrl = URL.createObjectURL(blob);
                const defaultCaption = `Voice note (${formatVoiceDuration(Math.floor(pendingVoicePreviewDuration))})`;
                if (voiceStopIntent === 'send') {
                    const captionInput = document.getElementById('voice-preview-caption');
                    if (captionInput) captionInput.value = defaultCaption;
                    await sendPendingVoiceNote(defaultCaption);
                } else {
                    openVoicePreviewModal(defaultCaption);
                }
            } catch (err) {
                console.error('Failed to prepare voice preview:', err);
                alert('Could not prepare voice note for sending. Please try again.');
            } finally {
                voiceStopIntent = 'preview';
            }
        };

        voiceMediaRecorder.start();
        isVoiceRecording = true;
        const voiceBtn = document.getElementById('voice-note-btn');
        if (voiceBtn) {
            voiceBtn.textContent = '⏹️';
            voiceBtn.classList.add('recording-pulse');
        }
        startVoiceRecordingTimer();
    } catch (err) {
        console.error('Voice note recording failed:', err);
        alert('Unable to start voice recording. Please allow microphone access.');
        resetVoiceRecordingUi();
    }
}

function stopVoiceRecording(options = {}) {
    if (!isVoiceRecording || !voiceMediaRecorder) return;
    voiceStopIntent = options.intent || 'preview';
    if (voiceMediaRecorder.state === 'paused') {
        voiceMediaRecorder.resume();
    }
    isVoiceRecording = false;
    voiceMediaRecorder.stop();
}

function toggleVoiceRecordingPause() {
    if (!voiceMediaRecorder || !isVoiceRecording) return;
    if (voiceMediaRecorder.state === 'recording') {
        voiceMediaRecorder.pause();
    } else if (voiceMediaRecorder.state === 'paused') {
        voiceMediaRecorder.resume();
    }
}

function cancelVoiceRecording() {
    if (!isVoiceRecording || !voiceMediaRecorder) return;
    stopVoiceRecording({ intent: 'discard' });
}

function openVoicePreviewModal(defaultCaption) {
    const modal = document.getElementById('voice-preview-modal');
    const player = document.getElementById('voice-preview-player');
    const captionInput = document.getElementById('voice-preview-caption');
    const durationEl = document.getElementById('voice-preview-duration');
    if (!modal || !player || !captionInput || !durationEl) {
        console.error('Voice preview modal elements are missing');
        return;
    }

    player.src = pendingVoicePreviewUrl || pendingVoicePreviewData || '';
    player.controls = true;
    player.preload = 'metadata';
    player.currentTime = 0;
    player.load();
    updateVoicePreviewPlayState(false);
    captionInput.value = defaultCaption || '';
    durationEl.textContent = `Duration: ${formatVoiceDuration(pendingVoicePreviewDuration)}`;
    modal.classList.add('open');
    document.body.classList.add('modal-open');
}

function updateVoicePreviewPlayState(isPlaying) {
    const stateEl = document.getElementById('voice-preview-play-state');
    const playBtn = document.getElementById('voice-preview-play');
    if (stateEl) {
        stateEl.textContent = isPlaying ? 'Playing...' : 'Ready to play';
    }
    if (playBtn) {
        playBtn.textContent = isPlaying ? 'Pause' : 'Play';
    }
}

function resetVoicePreviewPlayer() {
    const player = document.getElementById('voice-preview-player');
    if (!player) return;
    player.pause();
    player.currentTime = 0;
    updateVoicePreviewPlayState(false);
}

function showEnableAudioButton(show) {
    // Enable Audio button was removed from UI.
    return;
}

function unlockCallAudioPlayback() {
    if (hasUnlockedCallAudio) return;
    hasUnlockedCallAudio = true;

    const remoteAudio = document.getElementById('remote-audio');
    const remoteVideo = document.getElementById('remote-video');
    const targets = [ringtone, remoteAudio, remoteVideo].filter(Boolean);

    targets.forEach((media) => {
        try {
            const playPromise = media.play?.();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.then(() => {
                    if (media === ringtone) {
                        media.pause();
                        media.currentTime = 0;
                    }
                }).catch(() => {});
            }
        } catch (_) {
            // ignore unlock errors - this is best effort
        }
    });
}

function setupAudioUnlockGestures() {
    const unlockOnce = () => {
        unlockCallAudioPlayback();
        document.removeEventListener('touchstart', unlockOnce, true);
        document.removeEventListener('click', unlockOnce, true);
        document.removeEventListener('keydown', unlockOnce, true);
    };

    document.addEventListener('touchstart', unlockOnce, true);
    document.addEventListener('click', unlockOnce, true);
    document.addEventListener('keydown', unlockOnce, true);
}

function showCallOverlay(statusText) {
    const callArea = document.getElementById('call-area');
    const callStatus = document.getElementById('call-status');
    if (callStatus && statusText) {
        callStatus.textContent = statusText;
    }
    if (callArea) {
        callArea.style.display = 'flex';
    }
    document.body.classList.add('call-active');
    showEnableAudioButton(true);
    if (isMobileLayout()) {
        openCallsPanel();
    }
}

function hideCallOverlay() {
    const callArea = document.getElementById('call-area');
    if (callArea) {
        callArea.style.display = 'none';
    }
    document.body.classList.remove('call-active');
    showEnableAudioButton(false);
}

function formatCallDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function updateCallDuration() {
    if (!callStartTime) return;
    const elapsed = Date.now() - callStartTime;
    const label = document.getElementById('call-duration');
    if (label) label.textContent = formatCallDuration(elapsed);
}

function startCallTimer() {
    callStartTime = Date.now();
    updateCallDuration();
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(updateCallDuration, 1000);
}

function stopCallTimer() {
    if (callTimer) {
        clearInterval(callTimer);
        callTimer = null;
    }
    callStartTime = null;
    const label = document.getElementById('call-duration');
    if (label) label.textContent = '00:00';
}

function toggleLocalMute() {
    if (!localStream) return;
    const audioTracks = localStream.getAudioTracks();
    if (!audioTracks.length) return;
    isMicMuted = !isMicMuted;
    audioTracks.forEach(track => {
        track.enabled = !isMicMuted;
    });
    const muteBtn = document.getElementById('mute-call-btn');
    if (muteBtn) {
        muteBtn.textContent = isMicMuted ? 'Unmute mic' : 'Mute mic';
    }
}

function setCallVolume(value) {
    currentSpeakerVolume = value;
    const remoteVideo = document.getElementById('remote-video');
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteVideo) remoteVideo.volume = value;
    if (remoteAudio) remoteAudio.volume = value;
    const volumeLabel = document.getElementById('speaker-volume-value');
    if (volumeLabel) {
        volumeLabel.textContent = `${Math.round(value * 100)}%`;
    }
}

function ensureLocalOutgoingAudio(stream) {
    if (!stream) return;
    const tracks = stream.getAudioTracks();
    tracks.forEach((track) => {
        track.enabled = true;
        track.onended = () => console.warn('Local audio track ended unexpectedly');
        track.onmute = () => console.warn('Local audio track muted by browser/device policy');
        track.onunmute = () => console.log('Local audio track unmuted');
    });
    isMicMuted = false;
    const muteBtn = document.getElementById('mute-call-btn');
    if (muteBtn) {
        muteBtn.textContent = 'Mute mic';
    }
}

function attachRemoteCallStream(remoteStream, shouldUseVideo) {
    startCallTimer();
    const remoteVideo = document.getElementById('remote-video');
    const remoteAudio = document.getElementById('remote-audio');
    const hasRemoteVideo = remoteStream.getVideoTracks().length > 0;
    const useVideoStream = shouldUseVideo || hasRemoteVideo;

    if (remoteVideo) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.style.display = useVideoStream ? 'block' : 'none';
        remoteVideo.muted = true;
        remoteVideo.volume = currentSpeakerVolume;
        remoteVideo.playsInline = true;
        remoteVideo.autoplay = true;
    }

    if (remoteAudio) {
        remoteAudio.srcObject = remoteStream;
        remoteAudio.muted = false;
        remoteAudio.volume = currentSpeakerVolume;
        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
        remoteAudio.setAttribute('playsinline', 'true');
    }

    const attemptAudioFallback = () => {
        if (!remoteAudio) return;
        remoteAudio.style.display = 'block';
        remoteAudio.style.position = 'absolute';
        remoteAudio.style.width = '1px';
        remoteAudio.style.height = '1px';
        remoteAudio.style.opacity = '0';
        remoteAudio.style.pointerEvents = 'none';
        remoteAudio.style.left = '-9999px';
        remoteAudio.style.bottom = '0';
        remoteAudio.srcObject = remoteStream;
        remoteAudio.muted = false;
        remoteAudio.volume = currentSpeakerVolume;
        remoteAudio.playsInline = true;
        remoteAudio.play().then(() => {
            console.log('✓ Remote audio PLAYING (audio fallback)');
            showEnableAudioButton(false);
        }).catch((err) => {
            console.warn('❌ Audio fallback play failed:', err);
            showEnableAudioButton(true);
        });
    };

    if (useVideoStream && remoteVideo) {
        remoteVideo.play().then(() => {
            console.log('✓ Remote video/audio PLAYING');
            if (remoteAudio) {
                remoteAudio.play().then(() => showEnableAudioButton(false)).catch(() => showEnableAudioButton(true));
            } else {
                showEnableAudioButton(false);
            }
        }).catch((err) => {
            console.warn('❌ Remote video autoplay failed:', err);
            showEnableAudioButton(true);
            attemptAudioFallback();
        });
    } else {
        attemptAudioFallback();
    }

    remoteStream.getAudioTracks().forEach((track) => {
        console.log('Remote audio track status:', track.label, track.enabled, track.readyState);
    });
}

function applyWallpaper(theme, customImageUrl = null) {
    const chatPanel = document.querySelector('.chat-panel');
    const messagesContainer = document.getElementById('messages-container');
    const body = document.body;
    if (!chatPanel || !messagesContainer || !body) return;

    const wallpaper = theme || 'default';
    const fallbackDefault = "radial-gradient(circle at 20% 20%, rgba(102,126,234,0.18), transparent 24%), radial-gradient(circle at 80% 40%, rgba(23,162,184,0.16), transparent 26%), linear-gradient(135deg, rgba(15,23,42,0.96), rgba(17,24,39,0.96)), url('data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'%3E%3Crect width='240' height='240' fill='none'/%3E%3Cpath d='M40 200V88h42v-20h76v20h42v112H40z' fill='rgba(255,255,255,0.06)' stroke='rgba(255,255,255,0.16)' stroke-width='4'/%3E%3Cpath d='M72 112h24v56H72zM144 112h24v56h-24z' fill='rgba(255,255,255,0.08)'/%3E%3Ccircle cx='120' cy='70' r='18' fill='rgba(255,255,255,0.08)'/%3E%3C/svg%3E')";
    const wallpaperStyles = {
        default: fallbackDefault,
        sunset: "radial-gradient(circle at 30% 30%, rgba(255,107,107,0.2), transparent 24%), radial-gradient(circle at 70% 70%, rgba(255,195,0,0.16), transparent 24%), linear-gradient(135deg, rgba(36,17,58,0.96), rgba(29,59,87,0.96)), url('data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'%3E%3Crect width='240' height='240' fill='none'/%3E%3Cpath d='M40 200V88h42v-20h76v20h42v112H40z' fill='rgba(255,255,255,0.05)' stroke='rgba(255,255,255,0.16)' stroke-width='4'/%3E%3Cpath d='M72 112h24v56H72zM144 112h24v56h-24z' fill='rgba(255,255,255,0.07)'/%3E%3Ccircle cx='120' cy='70' r='18' fill='rgba(255,255,255,0.07)'/%3E%3C/svg%3E')",
        forest: "radial-gradient(circle at 20% 20%, rgba(46,204,113,0.18), transparent 24%), radial-gradient(circle at 82% 24%, rgba(255,255,255,0.12), transparent 24%), linear-gradient(135deg, rgba(17,37,27,0.96), rgba(22,50,36,0.96)), url('data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'%3E%3Crect width='240' height='240' fill='none'/%3E%3Cpath d='M40 200V88h42v-20h76v20h42v112H40z' fill='rgba(255,255,255,0.05)' stroke='rgba(255,255,255,0.16)' stroke-width='4'/%3E%3Cpath d='M72 112h24v56H72zM144 112h24v56h-24z' fill='rgba(255,255,255,0.07)'/%3E%3Ccircle cx='120' cy='70' r='18' fill='rgba(255,255,255,0.07)'/%3E%3C/svg%3E')"
    };

    const selectedBackground = wallpaper === 'custom' && customImageUrl
        ? `linear-gradient(135deg, rgba(15,23,42,0.75), rgba(15,23,42,0.86)), url(${customImageUrl})`
        : wallpaperStyles[wallpaper] || wallpaperStyles.default;

    chatPanel.style.backgroundImage = selectedBackground;
    chatPanel.style.backgroundSize = 'cover';
    chatPanel.style.backgroundPosition = 'center';
    chatPanel.style.backgroundRepeat = 'no-repeat';
    messagesContainer.style.background = 'linear-gradient(180deg, rgba(10, 16, 28, 0.24) 0%, rgba(8, 12, 20, 0.36) 100%)';
    messagesContainer.style.backdropFilter = 'blur(2px)';
    body.dataset.wallpaper = wallpaper;
    localStorage.setItem('foreman-wallpaper', wallpaper);
    if (customImageUrl) localStorage.setItem('foreman-wallpaper-custom', customImageUrl);
}

function closeWallpaperPicker() {
    const modal = document.getElementById('wallpaper-picker-modal');
    if (modal) modal.classList.remove('open');
}

function openWallpaperPicker() {
    const modal = document.getElementById('wallpaper-picker-modal');
    if (!modal) return;
    const saved = localStorage.getItem('foreman-wallpaper') || 'default';
    modal.querySelectorAll('.wallpaper-option').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.wallpaper === saved);
    });
    modal.classList.add('open');
}

function setupCallControls() {
    const muteBtn = document.getElementById('mute-call-btn');
    if (muteBtn) {
        muteBtn.addEventListener('click', toggleLocalMute);
    }
    const volumeSlider = document.getElementById('speaker-volume');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (event) => {
            const value = parseFloat(event.target.value);
            if (!Number.isNaN(value)) setCallVolume(value);
        });
    }
}

function closeVoicePreviewModal() {
    const modal = document.getElementById('voice-preview-modal');
    const player = document.getElementById('voice-preview-player');
    const captionInput = document.getElementById('voice-preview-caption');
    if (modal) {
        modal.classList.remove('open');
    }
    if (document.body) {
        document.body.classList.remove('modal-open');
    }
    if (player) {
        player.pause();
        player.src = '';
        updateVoicePreviewPlayState(false);
    }
    if (captionInput) {
        captionInput.value = '';
    }
    if (pendingVoicePreviewUrl) {
        URL.revokeObjectURL(pendingVoicePreviewUrl);
        pendingVoicePreviewUrl = null;
    }
    pendingVoicePreviewData = null;
    pendingVoicePreviewDuration = 0;
    pendingVoiceBlob = null;
}

function sendPendingVoiceNote(fallbackCaption = '') {
    if (!pendingVoicePreviewData || !selectedUser) {
        closeVoicePreviewModal();
        return;
    }

    const messageId = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const conversationKey = getConversationKey(selectedUser);
    const isGroup = isGroupSelected();
    const recipientDbId = selectedUser.dbId || selectedUser.id;
    const recipientSocketId = isGroup ? null : getSocketIdForUser(selectedUser);
    const timestamp = new Date().toLocaleTimeString();
    const status = isGroup || recipientSocketId ? 'delivered' : 'queued';
    const captionInput = document.getElementById('voice-preview-caption');
    const caption = captionInput?.value?.trim() || fallbackCaption || `Voice note (${formatVoiceDuration(pendingVoicePreviewDuration)})`;

    const outgoingPayload = {
        id: messageId,
        message: pendingVoicePreviewData,
        caption,
        replyTo: replyingTo,
        mediaType: 'audio',
        isMedia: true,
        fromDbId: user.dbId,
        username: user.username,
        toDbId: recipientDbId
    };

    if (isGroup) {
        socket.emit('send group message', {
            id: messageId,
            groupId: selectedUser.groupId,
            message: pendingVoicePreviewData,
            caption,
            replyTo: replyingTo,
            mediaType: 'audio',
            type: 'media',
            timestamp
        });
    } else if (recipientSocketId) {
        socket.emit('direct message', { ...outgoingPayload, to: recipientSocketId });
    } else {
        queuePendingMessage(recipientDbId, outgoingPayload);
    }

    if (!userConversations[conversationKey]) {
        userConversations[conversationKey] = [];
    }

    const localMessage = {
        id: messageId,
        username: user.username,
        message: pendingVoicePreviewData,
        caption,
        replyTo: replyingTo,
        mediaType: 'audio',
        timestamp,
        isOwn: true,
        type: 'media',
        status
    };

    userConversations[conversationKey].push(localMessage);
    displayMediaMessage(localMessage);
    saveConversationToStorage(conversationKey);
    clearReplyTarget();
    closeVoicePreviewModal();
}

function cancelPendingVoiceNote() {
    closeVoicePreviewModal();
}

document.addEventListener('DOMContentLoaded', () => {
    setupAudioUnlockGestures();
    setVoiceRecordingMode('hold');
    updateVoiceRecordingUi();

    const voiceNoteBtn = document.getElementById('voice-note-btn');
    if (voiceNoteBtn) {
        let suppressNextVoiceTap = false;
        let holdStartTimer = null;
        let holdRecordingActive = false;
        const HOLD_START_DELAY_MS = 180;

        voiceNoteBtn.addEventListener('click', () => {
            if (suppressNextVoiceTap) {
                suppressNextVoiceTap = false;
                return;
            }
            if (isVoiceRecording) {
                stopVoiceRecording({ intent: 'preview' });
                return;
            }
            startVoiceRecording();
        });

        const holdStart = (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            holdRecordingActive = false;
            if (holdStartTimer) clearTimeout(holdStartTimer);
            holdStartTimer = setTimeout(() => {
                holdStartTimer = null;
                holdRecordingActive = true;
                if (!isVoiceRecording) startVoiceRecording();
            }, HOLD_START_DELAY_MS);
        };

        const holdEnd = (event) => {
            if (holdStartTimer) {
                clearTimeout(holdStartTimer);
                holdStartTimer = null;
                return;
            }
            if (!holdRecordingActive) return;
            event.preventDefault();
            if (isVoiceRecording) stopVoiceRecording({ intent: 'preview' });
            holdRecordingActive = false;
            suppressNextVoiceTap = true;
        };

        voiceNoteBtn.addEventListener('pointerdown', holdStart);
        voiceNoteBtn.addEventListener('pointerup', holdEnd);
        voiceNoteBtn.addEventListener('pointercancel', (event) => {
            if (holdStartTimer) {
                clearTimeout(holdStartTimer);
                holdStartTimer = null;
            }
            if (holdRecordingActive && isVoiceRecording) {
                stopVoiceRecording({ intent: 'preview' });
                holdRecordingActive = false;
                suppressNextVoiceTap = true;
            }
            event.preventDefault();
        });
        voiceNoteBtn.addEventListener('pointerleave', (event) => {
            if (event.buttons !== 0) return;
            if (holdStartTimer) {
                clearTimeout(holdStartTimer);
                holdStartTimer = null;
            }
            if (holdRecordingActive && isVoiceRecording) {
                stopVoiceRecording({ intent: 'preview' });
                holdRecordingActive = false;
                suppressNextVoiceTap = true;
            }
        });
    }

    document.getElementById('voice-record-pause-btn')?.addEventListener('click', toggleVoiceRecordingPause);
    document.getElementById('voice-record-send-btn')?.addEventListener('click', () => {
        if (!isVoiceRecording) return;
        stopVoiceRecording({ intent: 'send' });
    });
    document.getElementById('voice-record-cancel-btn')?.addEventListener('click', cancelVoiceRecording);

    document.getElementById('voice-mode-hold')?.addEventListener('click', () => setVoiceRecordingMode('hold'));
    document.getElementById('voice-mode-tap')?.addEventListener('click', () => setVoiceRecordingMode('tap'));

    const voicePreviewSend = document.getElementById('voice-preview-send');
    if (voicePreviewSend) {
        voicePreviewSend.addEventListener('click', sendPendingVoiceNote);
    }

    const voicePreviewCancel = document.getElementById('voice-preview-cancel');
    if (voicePreviewCancel) {
        voicePreviewCancel.addEventListener('click', cancelPendingVoiceNote);
    }

    const voicePreviewPlay = document.getElementById('voice-preview-play');
    const voicePreviewPlayer = document.getElementById('voice-preview-player');
    if (voicePreviewPlay && voicePreviewPlayer) {
        voicePreviewPlay.addEventListener('click', () => {
            if (voicePreviewPlayer.paused) {
                voicePreviewPlayer.play().catch((err) => {
                    console.warn('Voice preview playback failed:', err);
                    try {
                        console.warn('previewUrl:', pendingVoicePreviewUrl);
                        console.warn('previewData length:', pendingVoicePreviewData ? pendingVoicePreviewData.length : 0);
                        console.warn('pendingVoiceBlob size:', pendingVoiceBlob ? pendingVoiceBlob.size : 0);
                        console.warn('audio element src:', voicePreviewPlayer.src);
                    } catch (e) {
                        console.warn('Error while dumping preview diagnostics', e);
                    }
                });
            } else {
                voicePreviewPlayer.pause();
            }
        });
        voicePreviewPlayer.addEventListener('play', () => updateVoicePreviewPlayState(true));
        voicePreviewPlayer.addEventListener('pause', () => updateVoicePreviewPlayState(false));
        voicePreviewPlayer.addEventListener('ended', () => updateVoicePreviewPlayState(false));
        voicePreviewPlayer.addEventListener('error', (ev) => {
            console.error('Voice preview audio element error event:', ev);
            try {
                const mediaError = voicePreviewPlayer.error;
                if (mediaError) {
                    console.error('MediaError code:', mediaError.code, 'message:', mediaError.message || 'n/a');
                }
            } catch (e) {
                console.error('Failed to read mediaError details', e);
            }
            console.warn('previewUrl at error:', pendingVoicePreviewUrl);
            console.warn('previewData length at error:', pendingVoicePreviewData ? pendingVoicePreviewData.length : 0);
            console.warn('pendingVoiceBlob size at error:', pendingVoiceBlob ? pendingVoiceBlob.size : 0);
            console.warn('audio element src at error:', voicePreviewPlayer.src);
        });
    }

    const wallpaperBtn = document.getElementById('wallpaper-btn');
    if (wallpaperBtn) {
        wallpaperBtn.addEventListener('click', openWallpaperPicker);
    }

    document.getElementById('wallpaper-cancel-btn')?.addEventListener('click', closeWallpaperPicker);
    document.getElementById('wallpaper-picker-modal')?.addEventListener('click', (event) => {
        if (event.target.id === 'wallpaper-picker-modal') closeWallpaperPicker();
    });
    document.querySelectorAll('.wallpaper-option').forEach((option) => {
        option.addEventListener('click', () => {
            const theme = option.dataset.wallpaper || 'default';
            document.querySelectorAll('.wallpaper-option').forEach((item) => item.classList.remove('active'));
            option.classList.add('active');
            if (theme === 'custom') {
                document.getElementById('wallpaper-input')?.click();
                return;
            }
            applyWallpaper(theme);
            closeWallpaperPicker();
        });
    });
    document.getElementById('wallpaper-upload-btn')?.addEventListener('click', () => document.getElementById('wallpaper-input')?.click());
    document.getElementById('wallpaper-input')?.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            applyWallpaper('custom', reader.result);
            closeWallpaperPicker();
        };
        reader.readAsDataURL(file);
    });

    const savedWallpaper = localStorage.getItem('foreman-wallpaper') || 'default';
    const savedCustomWallpaper = localStorage.getItem('foreman-wallpaper-custom');
    applyWallpaper(savedWallpaper, savedCustomWallpaper || null);

    setupCallControls();
});

function compressImageDataUrl(dataUrl, maxWidth = 1200, maxHeight = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const scale = Math.min(1, Math.min(maxWidth / width, maxHeight / height));
                if (scale < 1) {
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (err) {
                reject(err);
            }
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

document.getElementById('media-btn')?.addEventListener('click', () => {
    document.getElementById('media-input')?.click();
});

function getFileSizeLimitBytes(fileType) {
    if (fileType === 'image') return 20 * 1024 * 1024;
    if (fileType === 'video') return 30 * 1024 * 1024;
    if (fileType === 'audio') return 15 * 1024 * 1024;
    return 20 * 1024 * 1024;
}

function getFileSizeLimitLabel(fileType) {
    if (fileType === 'image') return '20MB';
    if (fileType === 'video') return '30MB';
    if (fileType === 'audio') return '15MB';
    return '20MB';
}

function resolveAttachmentType(file, forcedType = null) {
    if (forcedType) return forcedType;
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'document';
}

async function sendAttachmentFromFile(file, inputEl, forcedType = null) {
    if (!file || !selectedUser) return;

    const fileType = resolveAttachmentType(file, forcedType);
    const maxBytes = getFileSizeLimitBytes(fileType);
    if (file.size > maxBytes) {
        const humanType = fileType === 'document' ? 'document' : fileType;
        alert(`This ${humanType} is too large. Please choose a file smaller than ${getFileSizeLimitLabel(fileType)}.`);
        if (inputEl) inputEl.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        let base64Data = event.target.result;
        if (fileType === 'image') {
            try {
                base64Data = await compressImageDataUrl(base64Data);
            } catch (err) {
                console.warn('Image compression failed, sending original file', err);
            }
        }

        const typedInput = (document.getElementById('chat-input')?.value || '').trim();
        let caption = typedInput;
        if (!caption) {
            const prompted = window.prompt('Add a caption (optional):', '');
            if (prompted === null) {
                if (inputEl) inputEl.value = '';
                return;
            }
            caption = prompted.trim();
        }

        const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const conversationKey = getConversationKey(selectedUser);
        const isGroup = isGroupSelected();
        const recipientDbId = selectedUser.dbId || selectedUser.id;
        const recipientSocketId = isGroup ? null : getSocketIdForUser(selectedUser);
        const timestamp = new Date().toLocaleTimeString();
        const status = isGroup || recipientSocketId ? 'delivered' : 'queued';

        const outgoingPayload = {
            id: messageId,
            message: base64Data,
            caption,
            replyTo: replyingTo,
            mediaType: fileType,
            fileName: file.name || null,
            isMedia: true,
            fromDbId: user.dbId,
            username: user.username,
            toDbId: recipientDbId
        };

        if (isGroup) {
            socket.emit('send group message', {
                id: messageId,
                groupId: selectedUser.groupId,
                message: base64Data,
                caption,
                replyTo: replyingTo,
                mediaType: fileType,
                fileName: file.name || null,
                type: 'media',
                timestamp
            });
        } else if (recipientSocketId) {
            socket.emit('direct message', { ...outgoingPayload, to: recipientSocketId });
        } else {
            queuePendingMessage(recipientDbId, outgoingPayload);
        }

        if (!userConversations[conversationKey]) {
            userConversations[conversationKey] = [];
        }

        const localAttachment = {
            id: messageId,
            username: user.username,
            message: base64Data,
            caption,
            replyTo: replyingTo,
            mediaType: fileType,
            fileName: file.name || null,
            timestamp,
            isOwn: true,
            type: 'media',
            status
        };

        userConversations[conversationKey].push(localAttachment);
        displayMediaMessage(localAttachment);
        saveConversationToStorage(conversationKey);

        if (inputEl) inputEl.value = '';
        const input = document.getElementById('chat-input');
        if (input) input.value = '';
        clearReplyTarget();
    };
    reader.readAsDataURL(file);
}

// Media file input
document.getElementById('media-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    await sendAttachmentFromFile(file, e.target);
});

document.getElementById('document-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    await sendAttachmentFromFile(file, e.target, 'document');
});

function sendMessage() {
    const input = document.getElementById('chat-input');
    if (!input || !selectedUser) return;
    
    const message = input.value.trim();
    if (!message) return;

    console.log('=== SENDING MESSAGE ===');
    console.log('selectedUser:', selectedUser);
    console.log('connectedUsers:', connectedUsers);
    
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const conversationKey = getConversationKey(selectedUser);
    const isGroup = isGroupSelected();
    const recipientDbId = selectedUser.dbId || selectedUser.id;
    
    // Get FRESH socket ID from current connectedUsers
    const currentOnlineUser = connectedUsers.find(u => String(u.dbId) === String(recipientDbId));
    const recipientSocketId = isGroup ? null : (currentOnlineUser ? currentOnlineUser.id : null);
    
    console.log('recipientDbId:', recipientDbId);
    console.log('currentOnlineUser:', currentOnlineUser);
    console.log('recipientSocketId:', recipientSocketId);
    
    const timestamp = new Date().toLocaleTimeString();
    const status = isGroup || recipientSocketId ? 'delivered' : 'queued';
    
    // Send via socket (will be queued/delivered if online, or stored locally if offline)
    const outgoingPayload = {
        id: messageId,
        message,
        replyTo: replyingTo,
        mediaType: null,
        isMedia: false,
        fromDbId: user.dbId,
        username: user.username,
        toDbId: recipientDbId
    };

    if (isGroup) {
        socket.emit('send group message', {
            id: messageId,
            groupId: selectedUser.groupId,
            message,
            replyTo: replyingTo,
            mediaType: null,
            type: 'text',
            timestamp
        });
    } else if (recipientSocketId) {
        socket.emit('direct message', { ...outgoingPayload, to: recipientSocketId });
        socket.emit('user typing', { toSocketId: recipientSocketId, isTyping: false });
    } else {
        queuePendingMessage(recipientDbId, outgoingPayload);
    }
    
    // Store in conversation
    if (!userConversations[conversationKey]) {
        userConversations[conversationKey] = [];
    }
    userConversations[conversationKey].push({
        id: messageId,
        username: user.username,
        message: message,
        replyTo: replyingTo,
        timestamp,
        isOwn: true,
        type: 'text',
        status
    });
    
    // Display immediately
    displayMessage({ id: messageId, username: user.username, message, replyTo: replyingTo, timestamp, isOwn: true, type: 'text', status });
    
    // Save to storage
    saveConversationToStorage(conversationKey);
    
    input.value = '';
    clearReplyTarget();
}

// Search contacts
document.getElementById('search-contacts')?.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value || '';
    renderContactsList();
});

// Add Contact button focuses search and scrolls list into view
document.getElementById('add-contact-btn')?.addEventListener('click', () => {
    const search = document.getElementById('search-contacts');
    const list = document.getElementById('contacts-list');
    if (search) {
        search.focus();
        search.select();
    }
    if (list) {
        list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});

document.getElementById('create-group-btn')?.addEventListener('click', () => {
    createGroupFromSelection();
});

document.getElementById('add-group-members-btn')?.addEventListener('click', () => {
    if (!selectedUser || !selectedUser.isGroup) {
        alert('Open a group chat first.');
        return;
    }
    const membersRaw = window.prompt('Enter usernames to add (comma separated):');
    if (membersRaw === null) return;
    const usernames = membersRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const memberIds = allRegisteredUsers
        .filter(u => usernames.includes(String(u.username || '').toLowerCase()))
        .map(u => u.id);

    if (!memberIds.length) {
        alert('No matching users found to add.');
        return;
    }

    socket.emit('add group members', {
        groupId: selectedUser.groupId,
        members: memberIds
    }, (ack) => {
        if (!ack || !ack.success) {
            alert((ack && ack.error) || 'Could not add members.');
            return;
        }
        loadGroups();
        if (ack.group) selectGroup(ack.group);
    });
});

// Toggle map visibility
document.getElementById('toggle-map-btn')?.addEventListener('click', () => {
    const mapSection = document.getElementById('map-section');
    if (!mapSection) return;
    
    mapVisible = !mapVisible;
    mapSection.style.display = mapVisible ? 'block' : 'none';
    
    if (mapVisible && !map) {
        setTimeout(() => initMap(), 100);
    }
});

// Drop pin
document.getElementById('drop-pin-btn')?.addEventListener('click', () => {
    if (!map) {
        alert('Map not initialized');
        return;
    }
    
    const center = map.getCenter();
    const pinData = {
        lat: center.lat(),
        lng: center.lng(),
        user: user.username,
        category: user.category,
        fromDbId: user.dbId
    };
    
    socket.emit('drop pin', pinData);
    addPinToMap(pinData);
    storeDroppedPin(pinData);
});

// Share dropped pin to selected chat contact
document.getElementById('share-pin-chat-btn')?.addEventListener('click', () => {
    if (!selectedUser) {
        alert('Please select a contact first.');
        return;
    }

    if (!lastDroppedPin) {
        alert('Drop a pin on the map first, then tap "Share Pin to Chat".');
        return;
    }

    sendDroppedPinToChat(selectedUser, true);
});

// Share location
document.getElementById('share-location-btn')?.addEventListener('click', () => {
    openLocationShareModal('map');
});

function updateCallButtonStates() {
    // Keep buttons always enabled - checks will happen in click handlers
    console.log('Call buttons remain enabled');
}

function addCallToChat(type, contactName, contactId) {
    const conversationKey = getConversationKey(contactId);
    if (!userConversations[conversationKey]) {
        userConversations[conversationKey] = [];
    }
    
    let icon = '📞';
    let message = '';
    let color = '#3498db';
    
    if (type === 'missed') {
        icon = '📵';
        message = `Missed call`;
        color = '#e74c3c';
    } else if (type === 'declined') {
        icon = '📵';
        message = `Call declined`;
        color = '#e67e22';
    } else if (type === 'answered') {
        icon = '📞';
        message = `Call answered`;
        color = '#27ae60';
    } else if (type === 'outgoing') {
        icon = '📞';
        message = `Outgoing call`;
        color = '#3498db';
    }
    
    const callMessage = {
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        from: contactName,
        fromDbId: contactId,
        message: `${icon} ${message}`,
        timestamp: new Date().toLocaleTimeString(),
        type: 'call-history',
        callType: type,
        color: color
    };
    
    userConversations[conversationKey].push(callMessage);
    saveConversationToStorage(conversationKey);
    renderRecentCallsList();
    
    // Display if this user is selected
    if (selectedUser && (selectedUser.id === contactId || selectedUser.dbId === contactId)) {
        displayMessage(callMessage);
    }
}

function endCall() {
    console.log('endCall() called');
    
    // Notify the other peer that call is ending
    if (currentCall && selectedUser && !isGroupSelected()) {
        const recipientSocketId = connectedUsers.find(u => String(u.dbId) === String(selectedUser.dbId || selectedUser.id))?.id;
        if (recipientSocketId) {
            socket.emit('end-call', { to: recipientSocketId, toDbId: selectedUser.dbId || selectedUser.id });
            console.log('Sent end-call signal to', recipientSocketId);
        }
    }
    
    if (currentCall) {
        console.log('Closing current call');
        currentCall.close();
        currentCall = null;
    }
    if (localStream) {
        console.log('Stopping local stream tracks');
        localStream.getTracks().forEach((track) => track.stop());
        localStream = null;
    }
    // Stop ringtone if playing
    ringtone.pause();
    ringtone.currentTime = 0;
    
    hideCallOverlay();
    const localVideo = document.getElementById('local-video');
    if (localVideo) localVideo.srcObject = null;
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) {
        remoteVideo.srcObject = null;
        remoteVideo.pause();
        showEnableAudioButton(false);
    }
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
        remoteAudio.srcObject = null;
        remoteAudio.pause();
    }
    stopCallTimer();
}

// Listen for call-ended from other peer
socket.on('call-ended', (data) => {
    console.log('Received call-ended signal from', data.from);
    endCall();
});

document.getElementById('end-call-btn')?.addEventListener('click', endCall);
document.getElementById('hangup-floating-btn')?.addEventListener('click', endCall);

function addPinToMap(pinData) {
    if (!map || !pinData) return;
    
    const color = pinData.category === 'foreman' ? 'yellow' : 'red';
    const iconUrl = `http://maps.google.com/mapfiles/ms/icons/${color}-dot.png`;
    const isOwnPin = String(pinData.fromDbId || '') === String(user.dbId || '');

    const marker = new google.maps.Marker({
        position: { lat: pinData.lat, lng: pinData.lng },
        map: map,
        title: `${pinData.user} (${pinData.category})`,
        icon: iconUrl,
        animation: google.maps.Animation.DROP,
        draggable: isOwnPin
    });

    if (isOwnPin) {
        marker.addListener('dragend', () => {
            const moved = marker.getPosition();
            if (!moved) return;
            storeDroppedPin({ lat: moved.lat(), lng: moved.lng() });
            alert('Pin moved. You can now share this updated pin location.');
        });
    }
}

// Initialize on load
window.addEventListener('load', () => {
    console.log('App initialized');
    registerNotificationServiceWorker();
    ensureNotificationPermission();
    initWorkStatusSwitch();
    closeMobileChat();
    setActiveMobileTab('contacts');
    // Ensure all users are loaded even before socket events settle
    loadAllUsers();
    // Try to restore previous selectedUser selection after users are loaded
    setTimeout(() => {
        if (!selectedUser) {
            restoreSelectedUser();
        }
    }, 500);
    initLocationShareModal();
    renderRecentCallsList();
    // Periodically refresh the registry in case new users sign up
    setInterval(() => {
        loadAllUsers();
        loadGroups();
    }, 30000);
});

window.addEventListener('resize', () => {
    if (!isMobileLayout()) {
        closeMobileChat();
        setActiveMobileTab('contacts');
    }
});

document.getElementById('mobile-back-btn')?.addEventListener('click', () => {
    closeMobileChat();
});

document.getElementById('mobile-tab-contacts')?.addEventListener('click', () => {
    closeMobileChat();
    loadAllUsers();
    renderContactsList();
});

document.getElementById('mobile-tab-chat')?.addEventListener('click', () => {
    if (!selectedUser) {
        alert('Select a contact first to open chat.');
        setActiveMobileTab('contacts');
        return;
    }
    openMobileChat();
    // Ensure conversation is loaded when opening chat tab
    if (selectedUser) {
        loadConversation(getConversationKey(selectedUser));
    }
});

document.getElementById('mobile-tab-calls')?.addEventListener('click', () => {
    openCallsPanel();
});

document.getElementById('mobile-tab-profile')?.addEventListener('click', () => {
    openProfilePanel();
});

// Attach call button event listeners immediately (script loads at end of body, so DOM is ready)
console.log('Setting up call button event listeners');

// Call buttons
const callBtn = document.getElementById('call-btn');
console.log('Call button element found:', callBtn);
if (callBtn) {
    callBtn.addEventListener('click', (e) => {
        console.log('=== CALL BUTTON CLICKED ===');
        console.log('selectedUser:', selectedUser);
        console.log('peer:', peer);
        console.log('selectedUser.peerId:', selectedUser?.peerId);
        console.log('selectedUser.online:', selectedUser?.online);
        
        unlockCallAudioPlayback();

        if (!selectedUser) {
            alert('Please select a user to call.');
            return;
        }
        if (isGroupSelected()) {
            alert('Group calling is not available yet. Please choose a direct contact.');
            return;
        }
        
        // Get FRESH online status before calling
        const freshOnlineUser = connectedUsers.find(u => String(u.dbId) === String(selectedUser.dbId || selectedUser.id));
        if (freshOnlineUser) {
            selectedUser = {
                ...selectedUser,
                socketId: freshOnlineUser.id || freshOnlineUser.socketId || null,
                peerId: freshOnlineUser.peerId || null,
                online: true
            };
            console.log('Updated selectedUser with fresh data:', selectedUser);
        }
        
        // If user is offline or peer not ready, send missed call notification
        if (!selectedUser.online || !selectedUser.peerId) {
            console.log('User offline or peer not ready, sending missed call notification');
            const missedCallMsg = {
                type: 'missed-call',
                from: user.username,
                fromDbId: user.dbId,
                to: selectedUser.socketId || null,
                toDbId: selectedUser.dbId || selectedUser.id,
                timestamp: new Date().toLocaleTimeString(),
                message: `Missed call from ${user.username}`
            };
            socket.emit('missed-call', missedCallMsg);
            alert(`${selectedUser.username} is ${!selectedUser.online ? 'offline' : 'not ready for calls'}. They will be notified of your call attempt.`);
            return;
        }
        
        if (!peer) {
            alert('Your call system is still initializing. Please wait a moment and try again.');
            return;
        }

        if (!canUseCallMedia()) {
            alert('Calls need HTTPS on mobile browsers. Open the deployed HTTPS link or localhost over USB reverse.');
            return;
        }
        
        console.log('All checks passed, initiating call...');
        
        // Check if getUserMedia is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Your browser does not support audio calls. Please use Chrome, Safari, or Firefox on a secure connection (HTTPS).');
            return;
        }
        
        console.log('Requesting microphone access...');
        navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }, 
            video: false 
        })
            .then((stream) => {
                console.log('✓ Microphone access granted');
                console.log('Local stream tracks:', stream.getTracks());
                console.log('Audio tracks:', stream.getAudioTracks());
                stream.getAudioTracks().forEach(track => {
                    console.log('Audio track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
                });
                
                localStream = stream;
                ensureLocalOutgoingAudio(stream);
                const localVideo = document.getElementById('local-video');
                const remoteVideo = document.getElementById('remote-video');
                
                // Hide video elements for audio-only calls
                if (localVideo) {
                    localVideo.srcObject = stream;
                    localVideo.style.display = 'none';
                    localVideo.muted = true; // Mute local audio to prevent echo
                }
                if (remoteVideo) {
                    remoteVideo.style.display = 'none';
                }
                
                console.log('Calling peer:', selectedUser.peerId);
                if ((selectedUser.socketId || selectedUser.dbId) && selectedUser.socketId !== socket.id) {
                    socket.emit('call user', {
                        to: selectedUser.socketId || null,
                        toDbId: selectedUser.dbId || selectedUser.id,
                        callType: 'audio'
                    });
                }
            const call = peer.call(selectedUser.peerId, stream, {
                    metadata: { callType: 'audio' }
                });
                
                if (!call) {
                    console.error('❌ Failed to create call');
                    alert('Failed to initiate call. Please try again.');
                    endCall();
                    return;
                }
                
                console.log('✓ Call initiated:', call);
                
                // Monitor connection state
                if (call.peerConnection) {
                    call.peerConnection.oniceconnectionstatechange = () => {
                        const state = call.peerConnection.iceConnectionState;
                        console.log('[CALLER] ICE connection state:', state);
                        
                        if (state === 'disconnected') {
                            console.warn('[CALLER] ICE disconnected, attempting to recover...');
                            if (callStatus) callStatus.textContent = 'Reconnecting...';
                        } else if (state === 'failed') {
                            console.error('[CALLER] ICE connection failed');
                            if (callStatus) callStatus.textContent = 'Network unstable. Trying to reconnect...';
                        }
                    };
                    call.peerConnection.onconnectionstatechange = () => {
                        const state = call.peerConnection.connectionState;
                        console.log('[CALLER] Connection state:', state);
                        
                        if (state === 'failed') {
                            console.error('[CALLER] Connection failed');
                            if (callStatus) callStatus.textContent = 'Connection unstable. Waiting for recovery...';
                        }
                    };
                }
                
                // Show notification
                showNotification('Calling...', `Calling ${selectedUser.username}`);
                
                // Show call area immediately
                const callArea = document.getElementById('call-area');
                const callStatus = document.getElementById('call-status');
                if (callStatus) {
                    callStatus.textContent = 'Calling ' + selectedUser.username + '...';
                    console.log('✓ Call status updated');
                }
                showCallOverlay('Calling ' + selectedUser.username + '...');
                console.log('✓ Call area displayed');
                
                // Set timeout for connection - if no stream after 15 seconds, fail
                let remoteStreamReceived = false;
                const connectionTimeout = setTimeout(() => {
                    if (call && !remoteStreamReceived) {
                        console.error('Connection timeout - no remote stream received');
                        alert('Connection timeout. The call could not be established. Please check your internet connection and try again.');
                        endCall();
                    }
                }, 30000);
                
                call.on('stream', (remoteStream) => {
                    remoteStreamReceived = true;
                    clearTimeout(connectionTimeout);
                    console.log('✓ Received remote stream');
                    console.log('Remote stream tracks:', remoteStream.getTracks());
                    console.log('Remote audio tracks:', remoteStream.getAudioTracks());
                    console.log('Remote stream active:', remoteStream.active);
                    remoteStream.getAudioTracks().forEach(track => {
                        console.log('Remote audio track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
                    });

                    attachRemoteCallStream(remoteStream, false);
                    if (callStatus) callStatus.textContent = 'Connected to ' + selectedUser.username;

                    // Add outgoing call to chat as answered
                    addCallToChat('outgoing', selectedUser.username, selectedUser.id || selectedUser.dbId);
                });
                
                call.on('close', () => {
                    console.log('Call closed');
                    endCall();
                });
                
                call.on('error', (err) => {
                    console.error('❌ Call error:', err);
                    alert('Call failed: ' + err.message);
                    endCall();
                });
                
                currentCall = call;
                console.log('✓ Call setup complete');
            })
            .catch((err) => {
                console.error('❌ Microphone access error:', err);
                alert('Failed to access microphone. Please allow microphone access and try again.\n\nError: ' + err.message);
            });
    });
    console.log('✓ Call button event listener attached');
}

const videoBtn = document.getElementById('video-btn');
console.log('Video button element found:', videoBtn);
if (videoBtn) {
    videoBtn.addEventListener('click', () => {
        console.log('=== VIDEO BUTTON CLICKED ===');
        unlockCallAudioPlayback();
        if (!selectedUser) {
            alert('Please select a user to call.');
            return;
        }
        if (isGroupSelected()) {
            alert('Group calling is not available yet. Please choose a direct contact.');
            return;
        }

        const freshOnlineUser = connectedUsers.find(u => String(u.dbId) === String(selectedUser.dbId || selectedUser.id));
        if (freshOnlineUser) {
            selectedUser = {
                ...selectedUser,
                socketId: freshOnlineUser.id || freshOnlineUser.socketId || null,
                peerId: freshOnlineUser.peerId || null,
                online: true
            };
        }
        
        // If user is offline, send missed call notification
        if (!selectedUser.online || !selectedUser.peerId) {
            const missedCallMsg = {
                type: 'missed-call',
                from: user.username,
                fromDbId: user.dbId,
                to: selectedUser.socketId || null,
                toDbId: selectedUser.dbId || selectedUser.id,
                timestamp: new Date().toLocaleTimeString(),
                message: `Missed video call from ${user.username}`
            };
            socket.emit('missed-call', missedCallMsg);
            alert(`${selectedUser.username} is ${!selectedUser.online ? 'offline' : 'not ready for calls'}. They will be notified of your call attempt.`);
            return;
        }
        
        if (!peer) {
            alert('Your call system is still initializing. Please wait a moment and try again.');
            return;
        }

        if (!canUseCallMedia()) {
            alert('Video calls need HTTPS on mobile browsers. Open the deployed HTTPS link or localhost over USB reverse.');
            return;
        }
        
        console.log('Requesting camera/microphone access...');
        navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: { facingMode: 'user' }
        })
            .then((stream) => {
                console.log('✓ Camera/microphone access granted');
                localStream = stream;
                ensureLocalOutgoingAudio(stream);
                const localVideo = document.getElementById('local-video');
                const remoteVideo = document.getElementById('remote-video');
                
                // Show video elements for video calls
                if (localVideo) {
                    localVideo.srcObject = stream;
                    localVideo.style.display = 'block';
                }
                if (remoteVideo) {
                    remoteVideo.style.display = 'block';
                }
                
                console.log('Calling peer (video):', selectedUser.peerId);
                if ((selectedUser.socketId || selectedUser.dbId) && selectedUser.socketId !== socket.id) {
                    socket.emit('call user', {
                        to: selectedUser.socketId || null,
                        toDbId: selectedUser.dbId || selectedUser.id,
                        callType: 'video'
                    });
                }
                const call = peer.call(selectedUser.peerId, stream, {
                    metadata: { callType: 'video' }
                });
                
                if (!call) {
                    console.error('❌ Failed to create video call');
                    alert('Failed to initiate video call. Please try again.');
                    endCall();
                    return;
                }
                
                console.log('✓ Video call initiated:', call);
                
                // Show call area immediately
                const callArea = document.getElementById('call-area');
                const callStatus = document.getElementById('call-status');
                showCallOverlay('Calling ' + selectedUser.username + '...');
                
                call.on('stream', (remoteStream) => {
                    console.log('✓ Received remote video stream');
                    attachRemoteCallStream(remoteStream, true);
                    if (callStatus) callStatus.textContent = 'Connected to ' + selectedUser.username;
                });
                
                call.on('close', () => {
                    console.log('Video call closed');
                    endCall();
                });
                
                call.on('error', (err) => {
                    console.error('❌ Video call error:', err);
                    alert('Video call failed: ' + err.message);
                    endCall();
                });
                
                currentCall = call;
            })
            .catch((err) => {
                console.error('❌ Camera/microphone access error:', err);
                alert('Failed to access camera/microphone. Please allow access and try again.\n\nError: ' + err.message);
            });
    });
    console.log('✓ Video button event listener attached');
}

// Profile Modal Handlers
document.getElementById('view-profile-btn')?.addEventListener('click', () => {
    if (!selectedUser) return;
    // Get full user data from allRegisteredUsers to ensure all fields are available
    const userId = selectedUser.dbId || selectedUser.id;
    const fullUserData = allRegisteredUsers.find(u => u.id === userId);
    showProfileModal(fullUserData || selectedUser);
});

document.getElementById('profile-close-btn')?.addEventListener('click', () => {
    hideProfileModal();
});

document.getElementById('profile-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'profile-modal') {
        hideProfileModal();
    }
});

function showProfileModal(user) {
    if (!user) {
        console.error('showProfileModal called with no user data');
        return;
    }
    
    console.log('Showing profile for user:', user);
    
    const modal = document.getElementById('profile-modal');
    const avatar = document.getElementById('profile-avatar');
    const username = document.getElementById('profile-username');
    const category = document.getElementById('profile-category');
    const email = document.getElementById('profile-email');
    const phone = document.getElementById('profile-phone');
    const location = document.getElementById('profile-location');
    const locationField = document.getElementById('profile-location-field');
    const bio = document.getElementById('profile-bio');
    const bioField = document.getElementById('profile-bio-field');
    const joined = document.getElementById('profile-joined');
    
    if (avatar) {
        avatar.textContent = user.username.charAt(0).toUpperCase();
        avatar.className = `profile-avatar ${user.category || 'contractor'}`;
    }
    if (username) username.textContent = user.username;
    if (category) category.textContent = user.category === 'foreman' ? '👷 Foreman' : '🏗️ Contractor';
    if (email) email.textContent = user.email || 'Not available';
    if (phone) phone.textContent = user.phone || 'Not available';
    
    if (location && locationField) {
        if (user.location && user.location.trim()) {
            location.textContent = user.location;
            locationField.style.display = 'flex';
        } else {
            locationField.style.display = 'none';
        }
    }
    
    if (bio && bioField) {
        if (user.bio && user.bio.trim()) {
            bio.textContent = user.bio;
            bioField.style.display = 'flex';
        } else {
            bioField.style.display = 'none';
        }
    }
    
    if (joined) {
        if (user.createdAt) {
            const date = new Date(user.createdAt);
            joined.textContent = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        } else {
            joined.textContent = 'Not available';
        }
    }
    
    if (modal) modal.classList.add('active');
    if (isMobileLayout()) {
        setActiveMobileTab('profile');
    }

    // Show review bar for foremen
    if (typeof window.openReviewBar === 'function') {
        window.openReviewBar(user.id || user.dbId, user.category === 'foreman');
    }
}
function hideProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.classList.remove('active');
    if (isMobileLayout()) {
        setActiveMobileTab(document.body.classList.contains('mobile-chat-open') ? 'chat' : 'contacts');
    }
}
