console.log('===== MAIN.JS LOADING =====');
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

// Create ringtone audio element
const ringtone = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIF2i6/eeuTRALT6fk7bhiHAU7k9jzznwsBS59y/DajToIDmS56+ijUxMGQ5zd8sFuIgUugM7y24k2CBdou/3nrk0QC0+n5O26YxsGOpPY8858LAYufcvw2o06CA5kuevoo1MTBkOc3fLBbiIFL4HO8tuJNggXaLv9565NEAtPp+TtumMbBjqT2PPOfCwGLn3L8NqNOggOZLnr6KNTEwZDnN3ywW4iBTCBzvLbiTYIF2i7/eeuTRALT6fk7bpjGwY6k9jzznwsBi59y/DajToIDmS56+ijUxMGQ5zd8sFuIgUwgc7y24k2CBdou/3nrk0QC0+n5O26YxsGOpPY8858LAYufcvw2o06CA5kuevoo1MTBkOc3fLBbiIFMIHO8tuJNggXaLv9565NEAtPp+TtumMbBjqT2PPOfCwGLn3L8NqNOggOZLnr6KNTEwZDnN3ywW4iBTCBzvLbiTYIF2i7/eeuTRALT6fk7bpjGwY6k9jzznwsBi59y/DajToIDmS56+ijUxMGQ5zd8sFuIgUwgc7y24k2CBdou/3nrk0QC0+n5O26YxsGOpPY8858LAYufcvw2o06CA5kuevoo1MTBkOc3fLBbiIFMIHO8tuJNggXaLv9565NEAtPp+TtumMbBjqT2PPOfCwGLn3L8NqNOggOZLnr6KNTEwZDnN3ywW4iBTCBzvLbiTYIF2i7/eeuTRALT6fk7bpjGwY6k9jzznwsBi59y/DajToIDmS56+ijUxMGQ5zd8sFuIgUwgc7y24k2CBdou/3nrk0QC0+n5O26YxsGOpPY8858LAYufcvw2o06');
ringtone.loop = true;

function ensureNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    Notification.requestPermission().catch(() => {});
    return Notification.permission === 'granted';
}

function showNotification(title, body) {
    if (!('Notification' in window)) return;
    const send = () => new Notification(title, { body, icon: '💬' });
    if (Notification.permission === 'granted') {
        send();
    } else if (Notification.permission === 'default') {
        Notification.requestPermission().then((perm) => {
            if (perm === 'granted') send();
        }).catch(() => {});
    }
}

// --- Chat Persistence Functions ---
function getConversationKey(target) {
    if (!target) return null;
    if (typeof target === 'object') {
        return target.dbId || target.id || null;
    }
    return target; // assume already a key
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
    const dbId = targetUser.dbId || targetUser.id;
    if (!dbId) return null;
    const online = connectedUsers.find(u => u.dbId === dbId);
    return online ? online.id : null;
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
        allRegisteredUsers = data.users || [];
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

// --- Google Maps/Earth Initialization ---
function initPeer() {
    console.log('Initializing PeerJS...');
    console.log('User object:', user);
    console.log('Peer library available:', typeof Peer !== 'undefined');
    
    try {
        peer = new Peer({
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    {
                        urls: 'turn:numb.viagenie.ca',
                        username: 'webrtc@live.com',
                        credential: 'muazkh'
                    },
                    { 
                        urls: 'turn:openrelay.metered.ca:80',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ]
            },
            debug: 2
        });
        
        console.log('Peer object created:', peer);
        
        peer.on('open', (peerId) => {
            console.log('✓ Peer ID:', peerId);
            // Emit user join again with peer id once ready
            socket.emit('user join', {
                username: user.username,
                category: user.category,
                id: user.dbId,
                peerId: peerId
            });
            // Update call buttons now that our peer is ready
            updateCallButtonStates();
        });
        peer.on('call', (call) => {
            console.log('Incoming call received:', call);
            handleIncomingCall(call);
        });
        peer.on('error', (err) => {
            console.error('Peer error:', err);
        });
    } catch (err) {
        console.error('Failed to initialize Peer:', err);
    }
}

function handleIncomingCall(call) {
    // Try to map incoming peerId to a known user so we can update UI
    if (!selectedUser || selectedUser.peerId !== call.peer) {
        const matched = connectedUsers.find(u => u.peerId === call.peer);
        if (matched) {
            selectedUser = { ...matched, online: true };
            renderContactsList();
            loadConversation(matched.dbId || matched.id);
        }
    }

    const callArea = document.getElementById('call-area');
    const callStatus = document.getElementById('call-status');
    const callerName = selectedUser?.username || 'Incoming call';
    if (callStatus) {
        callStatus.textContent = `${callerName} is calling...`;
    }
    
    // Play ringtone
    ringtone.play().catch(err => console.log('Ringtone play failed:', err));
    
    // Show notification
    showNotification('Incoming Call', `${callerName} is calling...`);
    
    // Show call area with answer/decline buttons
    if (callArea) callArea.style.display = 'flex';
    if (callStatus) {
        callStatus.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 18px; margin-bottom: 20px;">${callerName} is calling...</div>
                <div style="display: flex; gap: 20px; justify-content: center;">
                    <button id="answer-call-btn" style="padding: 15px 30px; background: #27ae60; color: white; border: none; border-radius: 50px; cursor: pointer; font-size: 16px;">📞 Answer</button>
                    <button id="decline-call-btn" style="padding: 15px 30px; background: #e74c3c; color: white; border: none; border-radius: 50px; cursor: pointer; font-size: 16px;">❌ Decline</button>
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
            video: false 
        })
            .then((stream) => {
                console.log('✓ Microphone access granted for answering');
                console.log('Local stream tracks:', stream.getTracks());
                console.log('Audio tracks:', stream.getAudioTracks());
                stream.getAudioTracks().forEach(track => {
                    console.log('Audio track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
                });
                
                localStream = stream;
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
                
                console.log('Answering call...');
                call.answer(stream);
                
                // Monitor connection state
                if (call.peerConnection) {
                    call.peerConnection.oniceconnectionstatechange = () => {
                        const state = call.peerConnection.iceConnectionState;
                        console.log('[ANSWER] ICE connection state:', state);
                        
                        if (state === 'disconnected') {
                            console.warn('[ANSWER] ICE disconnected, attempting to recover...');
                        } else if (state === 'failed') {
                            console.error('[ANSWER] ICE connection failed');
                            alert('Connection failed. Please check your internet connection.');
                            endCall();
                        }
                    };
                    call.peerConnection.onconnectionstatechange = () => {
                        const state = call.peerConnection.connectionState;
                        console.log('[ANSWER] Connection state:', state);
                        
                        if (state === 'failed') {
                            console.error('[ANSWER] Connection failed');
                            alert('Connection failed. Please try again.');
                            endCall();
                        }
                    };
                }
                
                // Set timeout for connection
                const connectionTimeout = setTimeout(() => {
                    if (call && !document.getElementById('remote-video')?.srcObject) {
                        console.error('Connection timeout - no remote stream received');
                        alert('Connection timeout. Please try again.');
                        endCall();
                    }
                }, 15000);
                
                call.on('stream', (remoteStream) => {
                    clearTimeout(connectionTimeout);
                    console.log('✓ Remote stream received after answering');
                    console.log('Remote stream tracks:', remoteStream.getTracks());
                    console.log('Remote audio tracks:', remoteStream.getAudioTracks());
                    console.log('Remote stream active:', remoteStream.active);
                    remoteStream.getAudioTracks().forEach(track => {
                        console.log('Remote audio track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
                    });
                    
                    const remoteVideo = document.getElementById('remote-video');
                    console.log('Remote video element:', remoteVideo);
                    if (remoteVideo) {
                        remoteVideo.srcObject = remoteStream;
                        remoteVideo.muted = false; // Ensure remote audio is not muted
                        remoteVideo.volume = 1.0; // Max volume
                        console.log('Remote video element muted:', remoteVideo.muted, 'volume:', remoteVideo.volume);
                        
                        // Force play immediately
                        remoteVideo.play().then(() => {
                            console.log('✓ Remote audio PLAYING');
                            console.log('After play - muted:', remoteVideo.muted, 'volume:', remoteVideo.volume, 'paused:', remoteVideo.paused);
                        }).catch(e => {
                            console.error('❌ Autoplay failed:', e);
                            alert('Click anywhere to enable audio playback');
                            // Try manual play on any click
                            document.body.addEventListener('click', () => {
                                remoteVideo.play().then(() => {
                                    console.log('✓ Remote audio playing after user interaction');
                                }).catch(console.error);
                            }, { once: true });
                        });
                        
                        console.log('✓ Remote audio configured');
                    }
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
        zoom: 12,
        center: { lat: 40.7128, lng: -74.0060 }, // Default to NYC
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
            <h3 style="color: #667eea; margin-bottom: 15px;">🗺️ Map Preview (Demo Mode)</h3>
            <p style="color: #a0a0a0; margin-bottom: 10px;">Google Earth API is not configured</p>
            <div style="background: #1a1a2e; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; text-align: left; margin: 20px 0;">
                <p style="color: #ffffff; font-weight: bold; margin-bottom: 10px;">⚡ Quick Setup (5 minutes):</p>
                <ol style="color: #a0a0a0; line-height: 1.8; margin-left: 20px;">
                    <li>Visit <a href="https://console.cloud.google.com" target="_blank" style="color: #667eea;">Google Cloud Console</a></li>
                    <li>Create a new project</li>
                    <li>Enable "Maps JavaScript API"</li>
                    <li>Create an API key</li>
                    <li>Add to .env file</li>
                    <li>Restart server</li>
                </ol>
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
        peerId: null
    });
    loadAllConversationsFromStorage();
    loadOutboxFromStorage();
    initPeer();
    // Load all registered users on connect
    loadAllUsers();
});

socket.on('user joined', (data) => {
    console.log('user joined event received:', data);
    connectedUsers = data.users || [];
    console.log('connectedUsers array:', connectedUsers);
    
    // Update online user IDs and include peer IDs
    onlineUserIds = new Set(connectedUsers.map(u => u.dbId));
    // Update the selectedUser's peerId if they just came online
    if (selectedUser && connectedUsers.length > 0) {
        const updatedUser = connectedUsers.find(u => u.dbId === selectedUser.id);
        if (updatedUser) {
            console.log('Updating selectedUser peerId from:', selectedUser.peerId, 'to:', updatedUser.peerId);
            selectedUser.peerId = updatedUser.peerId;
            selectedUser.online = true;
            // Update call button states
            updateCallButtonStates();
        }
    }
    renderContactsList();
    const count = document.getElementById('user-count');
    if (count) count.textContent = Math.max(0, allRegisteredUsers.length - 1); // Show total registered users minus self
    // Try to flush queued messages to anyone who just came online
    Object.keys(pendingOutbox || {}).forEach(dbId => deliverPendingMessagesForUser(dbId));
});

socket.on('user left', (data) => {
    connectedUsers = data.users || [];
    // Update online user IDs
    onlineUserIds = new Set(connectedUsers.map(u => u.dbId));
    // If selected user went offline, mark them offline
    if (selectedUser && !onlineUserIds.has(selectedUser.id)) {
        selectedUser.online = false;
    }
    renderContactsList();
    const count = document.getElementById('user-count');
    if (count) count.textContent = Math.max(0, allRegisteredUsers.length - 1); // Show total registered users minus self
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

    const messagePayload = {
        id: data.id,
        username: data.username,
        message: data.message,
        mediaType: data.mediaType || null,
        timestamp: data.timestamp,
        isOwn: false,
        type: data.type || (data.isMedia ? 'media' : 'text'),
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
        if (data.isMedia || messagePayload.type === 'media') {
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
    
    showNotification(`New message from ${data.username}`, data.isMedia ? `[${(data.mediaType || '').toUpperCase()}]` : data.message);

    saveConversationToStorage(conversationKey);
});

socket.on('delete message', (data) => {
    if (!data || !data.messageId) return;
    removeMessageById(data.messageId);
});

socket.on('missed-call-notification', (data) => {
    console.log('Missed call notification received:', data);
    showNotification(`Missed Call from ${data.from}`, data.message || 'You have a missed call');
    
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
});

socket.on('receive pin', (pinData) => {
    pins.push(pinData);
    addPinToMap(pinData);
    console.log('New pin received:', pinData);
});

socket.on('incoming call', (data) => {
    if (data.fromSocketId !== socket.id) {
        if (confirm(`${data.from} is calling you. Accept?`)) {
            alert('Call feature coming soon!');
        }
    }
});

// --- Render Functions ---
function renderContactsList() {
    const list = document.getElementById('contacts-list');
    if (!list) return;

    if (allRegisteredUsers.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <p>No registered users yet</p>
            </div>
        `;
        return;
    }

    list.innerHTML = '';
    // Show all registered users
    allRegisteredUsers.forEach(contactUser => {
        const isOnline = onlineUserIds.has(contactUser.id);
        const onlineUser = connectedUsers.find(u => u.dbId === contactUser.id);
        const item = document.createElement('div');
        item.className = 'contact-item';
        if (selectedUser && selectedUser.id === contactUser.id) {
            item.classList.add('active');
        }
        
        const initial = contactUser.username.charAt(0).toUpperCase();
        const roleClass = contactUser.category === 'foreman' ? 'foreman' : 'contractor';
        const roleBadge = contactUser.category === 'foreman' ? '👷 Foreman' : '🏗️ Contractor';
        const roleBadgeColor = contactUser.category === 'foreman' ? '#ffc107' : '#17a2b8';
        const isSelf = contactUser.id === user.dbId;
        const selfBadge = isSelf ? ' <span style="color: #27ae60; font-weight: 700;">(You)</span>' : '';
        const onlineStatus = isOnline ? '🟢' : '⚫';
        const statusText = isOnline ? 'Online' : 'Offline';
        const statusColor = isOnline ? '#27ae60' : '#7f8c8d';
        
        const unreadCount = unreadMessages[contactUser.id] || 0;
        const unreadBadge = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : '';
        item.innerHTML = `
            <div class="contact-avatar ${roleClass}">${initial}</div>
            <div class="contact-info">
                <div class="contact-name">${contactUser.username}${selfBadge}</div>
                <div class="contact-role" style="color: ${roleBadgeColor}; font-weight: 600;">${roleBadge}</div>
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
        
        list.appendChild(item);
    });
}

function selectContact(contactUser, isOnline = false, onlineUser = null) {
    console.log('selectContact called with:', { contactUser, isOnline, onlineUser });
    
    // Always get FRESH online user data from connectedUsers
    const freshOnlineUser = connectedUsers.find(u => u.dbId === contactUser.id);
    const isFreshOnline = freshOnlineUser ? true : false;
    
    // Merge contactUser (with location) and fresh online data (with socket/peer info)
    if (isFreshOnline && freshOnlineUser) {
        selectedUser = { ...contactUser, ...freshOnlineUser, online: true };
    } else {
        selectedUser = { ...contactUser, online: false };
    }
    
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
    const locationButton = document.getElementById('location-share-btn');
    const callButton = document.getElementById('call-btn');
    const videoButton = document.getElementById('video-btn');
    
    if (avatar) {
        avatar.textContent = contactUser.username.charAt(0).toUpperCase();
        avatar.className = `contact-avatar ${contactUser.category}`;
    }
    if (name) name.textContent = contactUser.username;
    if (role) role.textContent = contactUser.category;
    
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
    if (locationButton) locationButton.disabled = false;
    // Call buttons stay enabled - handled by onclick
    
    // Load conversation history
    loadConversation(contactUser.id);
}

function loadConversation(userId) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    
    // Load from storage if not in memory
    if (!userConversations[userId]) {
        userConversations[userId] = loadConversationFromStorage(userId);
    }
    
    container.innerHTML = '';
    
    const conversationKey = getConversationKey(userId);
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
        if (msg.type === 'media') {
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
    
    // Handle location messages
    if (msg.type === 'location' && msg.locationUrl) {
        console.log('Rendering location message:', msg);
        messageEl.innerHTML = `
            <div style="padding: 8px; background: rgba(46, 204, 113, 0.1); border-radius: 8px;">
                <div style="margin-bottom: 8px;">${msg.message}</div>
                <a href="${msg.locationUrl}" target="_blank" style="display: inline-block; padding: 8px 16px; background: var(--success); color: white; text-decoration: none; border-radius: 6px; font-size: 13px;">View on Google Maps</a>
            </div>
            <div class="message-meta">${msg.isOwn ? 'You' : (msg.username || msg.from)} • ${timestamp} ${statusIcon}</div>
        `;
    } else {
        messageEl.innerHTML = `
            <div>${msg.message}</div>
            <div class="message-meta">${msg.isOwn ? 'You' : msg.username} • ${timestamp} ${statusIcon}</div>
        `;
    }
    
    if (msg.isOwn && msg.id) addDeleteButton(messageEl, msg.id);
    
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
    
    if (msg.mediaType === 'image') {
        mediaHtml = `<img src="${msg.message}" style="max-width: 200px; border-radius: 8px; margin-bottom: 8px;">`;
    } else if (msg.mediaType === 'video') {
        mediaHtml = `<video src="${msg.message}" controls style="max-width: 200px; border-radius: 8px; margin-bottom: 8px;"></video>`;
    }
    
    messageEl.innerHTML = `
        ${mediaHtml}
        <div class="message-meta">${msg.isOwn ? 'You' : msg.username} • ${timestamp} ${statusIcon}</div>
    `;
    
    if (msg.isOwn && msg.id) addDeleteButton(messageEl, msg.id);
    
    container.appendChild(messageEl);
    container.scrollTop = container.scrollHeight;
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

// --- Event Handlers ---
document.getElementById('send-btn')?.addEventListener('click', sendMessage);
document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Location share in chat
document.getElementById('location-share-btn')?.addEventListener('click', () => {
    if (!selectedUser) {
        alert('Please select a contact first');
        return;
    }
    
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
    }
    
    const locationBtn = document.getElementById('location-share-btn');
    locationBtn.disabled = true;
    locationBtn.textContent = '⏳';
    
    console.log('=== LOCATION SHARE CLICKED ===');
    console.log('selectedUser:', selectedUser);
    console.log('selectedUser.id:', selectedUser?.id);
    console.log('selectedUser.dbId:', selectedUser?.dbId);
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const locationUrl = `https://www.google.com/maps?q=${lat},${lng}`;
            const locationMessage = `📍 Location: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            
            console.log('Position received:', { lat, lng });
            console.log('Location URL:', locationUrl);
            console.log('Location message:', locationMessage);
            
            const msgData = {
                id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                type: 'location',
                from: user.username,
                fromDbId: user.dbId,
                to: selectedUser.id || selectedUser.dbId,
                message: locationMessage,
                locationUrl: locationUrl,
                lat: lat,
                lng: lng,
                timestamp: new Date().toLocaleTimeString()
            };
            
            console.log('Complete msgData object:', JSON.stringify(msgData, null, 2));
            
            // Get recipient's socket ID
            const recipientDbId = selectedUser.id || selectedUser.dbId;
            const currentOnlineUser = connectedUsers.find(u => u.dbId === recipientDbId);
            const recipientSocketId = currentOnlineUser ? currentOnlineUser.id : null;
            
            console.log('Sending location message:', msgData);
            console.log('Recipient socket ID:', recipientSocketId);
            
            if (recipientSocketId) {
                const messageToSend = { ...msgData, to: recipientSocketId };
                console.log('Final message object:', messageToSend);
                socket.emit('direct message', messageToSend);
            } else {
                console.warn('Recipient not online, message will be queued');
            }
            
            // Add to local conversation
            const conversationKey = getConversationKey(selectedUser.id || selectedUser.dbId);
            if (!userConversations[conversationKey]) {
                userConversations[conversationKey] = [];
            }
            const localMsg = { ...msgData, isOwn: true };
            userConversations[conversationKey].push(localMsg);
            displayMessage(localMsg);
            
            locationBtn.disabled = false;
            locationBtn.textContent = '📍';
            
            // Also drop pin on map
            const pinData = {
                lat: lat,
                lng: lng,
                user: user.username,
                category: user.category
            };
            socket.emit('drop pin', pinData);
            if (map) {
                addPinToMap(pinData);
            }
        },
        (error) => {
            alert('Could not get your location: ' + error.message);
            locationBtn.disabled = false;
            locationBtn.textContent = '📍';
        }
    );
});

// Media file input
document.getElementById('media-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedUser) return;
    
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    
    if (!isImage && !isVideo) {
        alert('Only images and videos are supported');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
        const base64Data = event.target.result;
        const mediaType = isImage ? 'image' : 'video';
        const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const conversationKey = getConversationKey(selectedUser);
        const recipientDbId = selectedUser.dbId || selectedUser.id;
        const recipientSocketId = getSocketIdForUser(selectedUser);
        const timestamp = new Date().toLocaleTimeString();
        const status = recipientSocketId ? 'delivered' : 'queued';
        
        const outgoingPayload = {
            id: messageId,
            message: base64Data,
            mediaType: mediaType,
            isMedia: true
        };

        if (recipientSocketId) {
            socket.emit('direct message', { ...outgoingPayload, to: recipientSocketId });
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
            message: base64Data,
            mediaType: mediaType,
            timestamp,
            isOwn: true,
            type: 'media',
            status
        });
        
        // Display immediately
        displayMediaMessage({ id: messageId, username: user.username, message: base64Data, mediaType, timestamp, isOwn: true, type: 'media', status });
        
        // Save to storage
        saveConversationToStorage(conversationKey);
        
        // Clear input
        e.target.value = '';
    };
    reader.readAsDataURL(file);
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
    const recipientDbId = selectedUser.dbId || selectedUser.id;
    
    // Get FRESH socket ID from current connectedUsers
    const currentOnlineUser = connectedUsers.find(u => u.dbId === recipientDbId);
    const recipientSocketId = currentOnlineUser ? currentOnlineUser.id : null;
    
    console.log('recipientDbId:', recipientDbId);
    console.log('currentOnlineUser:', currentOnlineUser);
    console.log('recipientSocketId:', recipientSocketId);
    
    const timestamp = new Date().toLocaleTimeString();
    const status = recipientSocketId ? 'delivered' : 'queued';
    
    // Send via socket (will be queued/delivered if online, or stored locally if offline)
    const outgoingPayload = {
        id: messageId,
        message: message,
        mediaType: null,
        isMedia: false
    };

    if (recipientSocketId) {
        socket.emit('direct message', { ...outgoingPayload, to: recipientSocketId });
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
        timestamp,
        isOwn: true,
        type: 'text',
        status
    });
    
    // Display immediately
    displayMessage({ id: messageId, username: user.username, message, timestamp, isOwn: true, type: 'text', status });
    
    // Save to storage
    saveConversationToStorage(conversationKey);
    
    input.value = '';
}

// Search contacts
document.getElementById('search-contacts')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const items = document.querySelectorAll('.contact-item');
    items.forEach(item => {
        const name = item.querySelector('.contact-name')?.textContent.toLowerCase() || '';
        item.style.display = name.includes(query) ? 'flex' : 'none';
    });
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
        category: user.category
    };
    
    socket.emit('drop pin', pinData);
    addPinToMap(pinData);
});

// Share location
document.getElementById('share-location-btn')?.addEventListener('click', () => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const pinData = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    user: user.username,
                    category: user.category
                };
                socket.emit('drop pin', pinData);
                if (map) {
                    map.setCenter({ lat: pinData.lat, lng: pinData.lng });
                    addPinToMap(pinData);
                }
            },
            (error) => {
                alert('Could not get your location: ' + error.message);
            }
        );
    } else {
        alert('Geolocation is not supported by your browser');
    }
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
    
    // Display if this user is selected
    if (selectedUser && (selectedUser.id === contactId || selectedUser.dbId === contactId)) {
        displayMessage(callMessage);
    }
}

function endCall() {
    console.log('endCall() called');
    
    // Notify the other peer that call is ending
    if (currentCall && selectedUser) {
        const recipientSocketId = connectedUsers.find(u => u.dbId === (selectedUser.id || selectedUser.dbId))?.id;
        if (recipientSocketId) {
            socket.emit('end-call', { to: recipientSocketId });
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
    
    const callArea = document.getElementById('call-area');
    if (callArea) callArea.style.display = 'none';
    const localVideo = document.getElementById('local-video');
    if (localVideo) localVideo.srcObject = null;
    const remoteVideo = document.getElementById('remote-video');
    if (remoteVideo) {
        remoteVideo.srcObject = null;
        remoteVideo.pause();
    }
}

// Listen for call-ended from other peer
socket.on('call-ended', (data) => {
    console.log('Received call-ended signal from', data.from);
    endCall();
});

document.getElementById('end-call-btn')?.addEventListener('click', endCall);

function addPinToMap(pinData) {
    if (!map || !pinData) return;
    
    const color = pinData.category === 'foreman' ? 'yellow' : 'red';
    const iconUrl = `http://maps.google.com/mapfiles/ms/icons/${color}-dot.png`;
    
    new google.maps.Marker({
        position: { lat: pinData.lat, lng: pinData.lng },
        map: map,
        title: `${pinData.user} (${pinData.category})`,
        icon: iconUrl,
        animation: google.maps.Animation.DROP
    });
}

// Initialize on load
window.addEventListener('load', () => {
    console.log('App initialized');
    ensureNotificationPermission();
    // Ensure all users are loaded even before socket events settle
    loadAllUsers();
    // Periodically refresh the registry in case new users sign up
    setInterval(loadAllUsers, 30000);
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
        
        if (!selectedUser) {
            alert('Please select a user to call.');
            return;
        }
        
        // Get FRESH online status before calling
        const freshOnlineUser = connectedUsers.find(u => u.dbId === (selectedUser.id || selectedUser.dbId));
        if (freshOnlineUser) {
            selectedUser = { ...selectedUser, ...freshOnlineUser, online: true };
            console.log('Updated selectedUser with fresh data:', selectedUser);
        }
        
        // If user is offline or peer not ready, send missed call notification
        if (!selectedUser.online || !selectedUser.peerId) {
            console.log('User offline or peer not ready, sending missed call notification');
            const missedCallMsg = {
                type: 'missed-call',
                from: user.username,
                fromDbId: user.dbId,
                to: selectedUser.id,
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
                const call = peer.call(selectedUser.peerId, stream);
                
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
                        } else if (state === 'failed') {
                            console.error('[CALLER] ICE connection failed');
                            alert('Connection failed. Please check your internet connection.');
                            endCall();
                        }
                    };
                    call.peerConnection.onconnectionstatechange = () => {
                        const state = call.peerConnection.connectionState;
                        console.log('[CALLER] Connection state:', state);
                        
                        if (state === 'failed') {
                            console.error('[CALLER] Connection failed');
                            alert('Connection failed. Please try again.');
                            endCall();
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
                if (callArea) {
                    callArea.style.display = 'flex';
                    console.log('✓ Call area displayed');
                }
                
                // Set timeout for connection - if no stream after 15 seconds, fail
                const connectionTimeout = setTimeout(() => {
                    if (call && !document.getElementById('remote-video')?.srcObject) {
                        console.error('Connection timeout - no remote stream received');
                        alert('Connection timeout. The call could not be established. Please check your internet connection and try again.');
                        endCall();
                    }
                }, 15000);
                
                call.on('stream', (remoteStream) => {
                    clearTimeout(connectionTimeout);
                    console.log('✓ Received remote stream');
                    console.log('Remote stream tracks:', remoteStream.getTracks());
                    console.log('Remote audio tracks:', remoteStream.getAudioTracks());
                    console.log('Remote stream active:', remoteStream.active);
                    remoteStream.getAudioTracks().forEach(track => {
                        console.log('Remote audio track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted, 'readyState:', track.readyState);
                    });
                    
                    const remoteVideo = document.getElementById('remote-video');
                    console.log('Remote video element:', remoteVideo);
                    if (remoteVideo) {
                        remoteVideo.srcObject = remoteStream;
                        remoteVideo.muted = false; // Ensure remote audio is not muted
                        remoteVideo.volume = 1.0; // Max volume
                        console.log('Remote video element muted:', remoteVideo.muted, 'volume:', remoteVideo.volume);
                        
                        // Force play immediately
                        remoteVideo.play().then(() => {
                            console.log('✓ Remote audio PLAYING');
                            console.log('After play - muted:', remoteVideo.muted, 'volume:', remoteVideo.volume, 'paused:', remoteVideo.paused);
                        }).catch(e => {
                            console.error('❌ Autoplay failed:', e);
                            alert('Click anywhere to enable audio playback');
                            // Try manual play on any click
                            document.body.addEventListener('click', () => {
                                remoteVideo.play().then(() => {
                                    console.log('✓ Remote audio playing after user interaction');
                                }).catch(console.error);
                            }, { once: true });
                        });
                        
                        console.log('✓ Remote audio configured');
                    }
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
        if (!selectedUser) {
            alert('Please select a user to call.');
            return;
        }
        
        // If user is offline, send missed call notification
        if (!selectedUser.online || !selectedUser.peerId) {
            const missedCallMsg = {
                type: 'missed-call',
                from: user.username,
                fromDbId: user.dbId,
                to: selectedUser.id,
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
        
        console.log('Requesting camera/microphone access...');
        navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } })
            .then((stream) => {
                console.log('✓ Camera/microphone access granted');
                localStream = stream;
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
                const call = peer.call(selectedUser.peerId, stream);
                
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
                if (callStatus) callStatus.textContent = 'Calling ' + selectedUser.username + '...';
                if (callArea) callArea.style.display = 'flex';
                
                call.on('stream', (remoteStream) => {
                    console.log('✓ Received remote video stream');
                    const remoteVideo = document.getElementById('remote-video');
                    if (remoteVideo) remoteVideo.srcObject = remoteStream;
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

    // Show review bar for foremen
    if (typeof window.openReviewBar === 'function') {
        window.openReviewBar(user.id || user.dbId, user.category === 'foreman');
    }
}
function hideProfileModal() {
    const modal = document.getElementById('profile-modal');
    if (modal) modal.classList.remove('active');
}
