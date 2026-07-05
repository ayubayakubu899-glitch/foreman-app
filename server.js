const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const bcrypt = require('bcrypt');
const { Server: SocketIO } = require('socket.io');
const { ExpressPeerServer } = require('peer');
require('dotenv').config();

const APP_ROOT = __dirname;
const DATA_DIR = path.join(APP_ROOT, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(APP_ROOT, 'views'));
app.use(express.static(path.join(APP_ROOT, 'public')));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

function ensureDataDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function loadUsersFromDisk() { try { ensureDataDir(); if (!fs.existsSync(USERS_FILE)) { fs.writeFileSync(USERS_FILE, '[]', 'utf8'); return []; } const raw = fs.readFileSync(USERS_FILE, 'utf8'); return JSON.parse(raw || '[]'); } catch (e) { console.warn('loadUsersFromDisk', e.message); return []; } }
function saveUsersToDisk(users) { try { ensureDataDir(); fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8'); } catch (e) { console.error('saveUsersToDisk', e.message); } }

let users = loadUsersFromDisk();
const sessions = new Map(); // sessionId -> sanitized user
const passwordResetTokens = new Map(); // token -> { userId, expiresAt }

function generateId(bytes = 20) { return crypto.randomBytes(bytes).toString('hex'); }
function sanitizeUser(u) { if (!u) return null; return { id: u.id, dbId: u.id, username: u.username, email: u.email, phone: u.phone, category: u.category, location: u.location || null, isAvailableForJob: !!u.isAvailableForJob, needsForeman: !!u.needsForeman, createdAt: u.createdAt }; }
function findUserByEmail(email) { return users.find(u => String(u.email).toLowerCase() === String(email).toLowerCase()); }
function getLocalIP() {
    const nets = os.networkInterfaces();
    const preferred = [];
    const fallback = [];
    for (const name of Object.keys(nets)) {
        for (const iface of nets[name]) {
            if (iface.family !== 'IPv4' || iface.internal || iface.address.startsWith('169.254')) continue;
            if (iface.address.startsWith('192.')) preferred.push(iface.address);
            else fallback.push(iface.address);
        }
    }
    return preferred[0] || fallback[0] || 'localhost';
}
function findConnectedSocketIdByDbId(dbId) {
    if (!dbId) return null;
    const match = Array.from(connectedUsers.values()).find(user => String(user.dbId) === String(dbId));
    return match ? (match.socketId || match.id || null) : null;
}
function getAdvertisedHost() {
    const envHost = process.env.HOST && process.env.HOST.trim();
    if (envHost && !['0.0.0.0', '::', '::1', 'localhost'].includes(envHost.toLowerCase())) {
        return envHost;
    }
    const localIp = getLocalIP();
    return localIp && localIp !== 'localhost' ? localIp : '0.0.0.0';
}

app.locals.port = PORT;
app.locals.protocol = process.env.HTTPS === 'true' ? 'https' : 'http';

app.use((req, res, next) => { console.log(new Date().toISOString(), req.method, req.path); next(); });

function requireAuth(req, res, next) {
    const sessionId = req.query.session || req.body.session || req.headers['x-session-id'];
    if (!sessionId || !sessions.has(sessionId)) return res.redirect('/');
    req.user = sessions.get(sessionId);
    next();
}

// Views
app.get('/', (req, res) => res.render('index'));
app.get('/signup', (req, res) => res.render('signup'));
app.get('/login', (req, res) => res.render('login', { message: req.query.message || null }));
app.get('/forgot-password', (req, res) => res.render('forgot-password', { message: null, resetLink: null }));

// Signup (hash password)
app.post('/signup', async (req, res) => {
    try {
        const { username, email, phone, password, category, location } = req.body;
        if (!username || !email || !phone || !password || !category) return res.status(400).send('Missing required fields');
        if (!location || !String(location).trim()) return res.status(400).send('Location required');
        if (findUserByEmail(email)) return res.status(409).send('Email already exists');
        if (users.some(u => u.username === username)) return res.status(409).send('Username taken');
        const phoneDigits = String(phone).replace(/\D/g, ''); if (phoneDigits.length < 10) return res.status(400).send('Invalid phone');
        const hashed = await bcrypt.hash(password, 10);
        const user = { id: generateId(8), username, email, phone, password: hashed, category, location: String(location).trim(), isAvailableForJob: category === 'foreman', needsForeman: false, createdAt: new Date().toISOString() };
        users.push(user); saveUsersToDisk(users);
        const sessionId = generateId(12); sessions.set(sessionId, sanitizeUser(user)); return res.redirect(`/dashboard?session=${sessionId}`);
    } catch (err) { console.error('signup', err); return res.status(500).send('Server error'); }
});

// Login
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body; if (!email || !password) return res.status(400).render('login', { message: 'Email and password required' });
        const user = findUserByEmail(email); if (!user) return res.status(401).render('login', { message: 'Invalid credentials' });
        const ok = await bcrypt.compare(password, user.password); if (!ok) return res.status(401).render('login', { message: 'Invalid credentials' });
        const sessionId = generateId(12); sessions.set(sessionId, sanitizeUser(user)); return res.redirect(`/dashboard?session=${sessionId}`);
    } catch (err) { console.error('login', err); return res.status(500).render('login', { message: 'Server error' }); }
});

app.get('/dashboard', requireAuth, (req, res) => res.render('dashboard', { user: req.user, sessionId: req.query.session, allUsers: users.map(sanitizeUser), googleEarthApiKey: process.env.GOOGLE_EARTH_API_KEY || '' }));
app.get('/settings', requireAuth, (req, res) => res.render('settings', { user: req.user, sessionId: req.query.session }));
app.get('/logout', (req, res) => { const sessionId = req.query.session; if (sessionId) sessions.delete(sessionId); res.redirect('/'); });

// Forgot / Reset password
app.post('/forgot-password', (req, res) => {
    const { email } = req.body; if (!email) return res.status(400).render('forgot-password', { message: 'Enter email', resetLink: null });
    const user = findUserByEmail(email); if (!user) return res.render('forgot-password', { message: 'If that email exists, a reset link was generated.', resetLink: null });
    const token = generateId(24); const expiresAt = Date.now() + (30 * 60 * 1000); passwordResetTokens.set(token, { userId: user.id, expiresAt });
    const resetLink = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`; return res.render('forgot-password', { message: 'Reset link generated.', resetLink });
});

app.get('/reset-password', (req, res) => {
    const { token } = req.query; if (!token || !passwordResetTokens.has(token)) return res.status(400).render('reset-password', { message: 'Invalid link', token: null, isValid: false });
    const record = passwordResetTokens.get(token); if (!record || Date.now() > record.expiresAt) { passwordResetTokens.delete(token); return res.status(400).render('reset-password', { message: 'Expired link', token: null, isValid: false }); }
    return res.render('reset-password', { message: null, token, isValid: true });
});

app.post('/reset-password', async (req, res) => {
    try {
        const { token, password, confirmPassword } = req.body; if (!token || !passwordResetTokens.has(token)) return res.status(400).render('reset-password', { message: 'Invalid token', token: null, isValid: false });
        if (!password || password.length < 6) return res.status(400).render('reset-password', { message: 'Password must be 6+ chars', token, isValid: true });
        if (password !== confirmPassword) return res.status(400).render('reset-password', { message: 'Passwords do not match', token, isValid: true });
        const record = passwordResetTokens.get(token); if (!record || Date.now() > record.expiresAt) { passwordResetTokens.delete(token); return res.status(400).render('reset-password', { message: 'Expired', token: null, isValid: false }); }
        const idx = users.findIndex(u => u.id === record.userId); if (idx === -1) { passwordResetTokens.delete(token); return res.status(404).render('reset-password', { message: 'User not found', token: null, isValid: false }); }
        users[idx].password = await bcrypt.hash(password, 10); saveUsersToDisk(users); passwordResetTokens.delete(token); return res.redirect('/login?message=' + encodeURIComponent('Password reset successful.'));
    } catch (err) { console.error('reset-password', err); return res.status(500).render('reset-password', { message: 'Server error', token: null, isValid: false }); }
});

// APIs
app.get('/api/status', (req, res) => res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() }));
app.get('/api/all-users', (req, res) => res.json({ users: users.map(sanitizeUser), total: users.length }));

app.post('/api/update-profile', (req, res) => {
    const { username, email, phone, location, bio, sessionId } = req.body;
    if (!sessionId || !sessions.has(sessionId)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const sessionUser = sessions.get(sessionId);
    const idx = users.findIndex(u => u.id === sessionUser.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'User not found' });
    if (email && users.some((u, i) => i !== idx && String(u.email).toLowerCase() === String(email).toLowerCase())) {
        return res.status(409).json({ success: false, error: 'Email already in use' });
    }
    if (username && users.some((u, i) => i !== idx && String(u.username).toLowerCase() === String(username).toLowerCase())) {
        return res.status(409).json({ success: false, error: 'Username already taken' });
    }
    users[idx].username = username || users[idx].username;
    users[idx].email = email || users[idx].email;
    users[idx].phone = phone || users[idx].phone;
    if (typeof location === 'string') users[idx].location = location.trim() || users[idx].location;
    users[idx].bio = typeof bio === 'string' ? bio.trim().slice(0, 500) : users[idx].bio || '';
    sessions.set(sessionId, sanitizeUser(users[idx]));
    saveUsersToDisk(users);
    return res.json({ success: true, user: sanitizeUser(users[idx]) });
});

app.post('/api/update-work-status', (req, res) => {
    const { sessionId, isAvailableForJob, needsForeman } = req.body;
    if (!sessionId || !sessions.has(sessionId)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const sessionUser = sessions.get(sessionId);
    const idx = users.findIndex(u => u.id === sessionUser.id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'User not found' });
    if (users[idx].category === 'foreman') {
        users[idx].isAvailableForJob = !!isAvailableForJob;
        users[idx].needsForeman = false;
    } else {
        users[idx].needsForeman = !!needsForeman;
        users[idx].isAvailableForJob = false;
    }
    sessions.set(sessionId, sanitizeUser(users[idx]));
    saveUsersToDisk(users);
    return res.json({ success: true, user: sanitizeUser(users[idx]) });
});

app.post('/api/change-password', async (req, res) => {
    const { currentPassword, newPassword, sessionId } = req.body; if (!sessionId || !sessions.has(sessionId)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const sessionUser = sessions.get(sessionId); const idx = users.findIndex(u => u.id === sessionUser.id); if (idx === -1) return res.status(404).json({ success: false, error: 'User not found' });
    const ok = await bcrypt.compare(currentPassword, users[idx].password); if (!ok) return res.status(401).json({ success: false, error: 'Current password incorrect' });
    users[idx].password = await bcrypt.hash(newPassword, 10); saveUsersToDisk(users); return res.json({ success: true });
});

app.post('/api/delete-account', (req, res) => { const { sessionId } = req.body; if (!sessionId || !sessions.has(sessionId)) return res.status(401).json({ success: false, error: 'Unauthorized' }); const sessionUser = sessions.get(sessionId); const idx = users.findIndex(u => u.id === sessionUser.id); if (idx !== -1) { users.splice(idx, 1); saveUsersToDisk(users); } sessions.delete(sessionId); return res.json({ success: true }); });

// Reviews
const reviews = [];
app.get('/api/reviews/:foremanId', (req, res) => { const foremanReviews = reviews.filter(r => r.foremanId === req.params.foremanId); const avg = foremanReviews.length ? (foremanReviews.reduce((s, r) => s + r.rating, 0) / foremanReviews.length).toFixed(1) : null; res.json({ reviews: foremanReviews, averageRating: avg, total: foremanReviews.length }); });
app.post('/api/reviews', (req, res) => { const { foremanId, rating, comment, sessionId } = req.body; if (!sessionId || !sessions.has(sessionId)) return res.status(401).json({ error: 'Unauthorized' }); const reviewer = sessions.get(sessionId); if (reviewer.id === foremanId) return res.status(400).json({ error: 'Cannot review yourself' }); const ratingNum = parseInt(rating, 10); if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: 'Rating 1-5' }); const existing = reviews.findIndex(r => r.foremanId === foremanId && r.reviewerId === reviewer.id); const reviewEntry = { id: existing >= 0 ? reviews[existing].id : generateId(6), foremanId, reviewerId: reviewer.id, reviewerName: reviewer.username, rating: ratingNum, comment: (comment || '').trim().slice(0,500), timestamp: new Date().toISOString() }; if (existing >= 0) reviews[existing] = reviewEntry; else reviews.push(reviewEntry); io && io.emit && io.emit('review updated', { foremanId }); return res.status(201).json({ message: 'Review saved', review: reviewEntry }); });

// Socket.io + pins
let useHttps = false;
let server;

const runningOnRender = !!process.env.RENDER;

try {
    if (runningOnRender) {
        console.log("Running on Render - using HTTP");
        server = http.createServer(app);
    } else {
        const certPath = path.join(APP_ROOT, "cert.pem");
        const keyPath = path.join(APP_ROOT, "key.pem");
        const pfxPath = path.join(APP_ROOT, "server-cert.pfx");

        if (process.env.HTTPS !== "false" &&
            fs.existsSync(certPath) &&
            fs.existsSync(keyPath)) {

            server = https.createServer(
                {
                    key: fs.readFileSync(keyPath),
                    cert: fs.readFileSync(certPath)
                },
                app
            );
            useHttps = true;

        } else if (
            process.env.HTTPS !== "false" &&
            fs.existsSync(pfxPath)
        ) {

            server = https.createServer(
                {
                    pfx: fs.readFileSync(pfxPath),
                    passphrase: process.env.PFX_PASSPHRASE || ""
                },
                app
            );
            useHttps = true;

        } else {
            server = http.createServer(app);
        }
    }

} catch (err) {
    console.warn("HTTPS initialization failed:", err.message);
    server = http.createServer(app);
    useHttps = false;
}

const io = new SocketIO(server, {
    cors: { origin: '*' },
    maxHttpBufferSize: 100 * 1024 * 1024
});

const peerServer = ExpressPeerServer(server, {
    proxied: true,
    allow_discovery: false,
    debug: false
});
app.use('/peerjs', peerServer);

const connectedUsers = new Map();
const pins = [];
const groups = new Map();

function toSocketPayloadGroup(group) {
    return {
        id: group.id,
        name: group.name,
        ownerDbId: group.ownerDbId,
        members: Array.from(group.members),
        createdAt: group.createdAt
    };
}

function resolveSocketId(targetSocketId, targetDbId) {
    if (targetSocketId && connectedUsers.has(String(targetSocketId))) {
        return String(targetSocketId);
    }
    if (targetDbId) {
        return findConnectedSocketIdByDbId(targetDbId);
    }
    return null;
}

function getGroupsForUser(dbId) {
    const id = String(dbId || '');
    if (!id) return [];
    return Array.from(groups.values())
        .filter(group => group.members.has(id))
        .map(toSocketPayloadGroup);
}

function joinUserGroups(socket, dbId) {
    const id = String(dbId || '');
    if (!id) return;
    groups.forEach((group) => {
        if (group.members.has(id)) {
            socket.join(`group:${group.id}`);
        }
    });
}

function getPresencePayload() {
    return { users: Array.from(connectedUsers.values()).map(user => ({
        ...user,
        id: user.id || user.socketId || null,
        socketId: user.socketId || user.id || null
    })) };
}

io.on('connection', (socket) => {
    console.log('socket connected', socket.id);

    const emitPresence = () => io.emit('user joined', getPresencePayload());

    socket.on('user join', (data) => {
        const sessionId = data && (data.sessionId || data.session);
        let userInfo = {
            dbId: data && (data.dbId || data.id || null),
            username: data && (data.username || 'Anonymous'),
            category: data && (data.category || null),
            peerId: data && (data.peerId || null)
        };

        if (sessionId && sessions.has(sessionId)) {
            const sessionUser = sessions.get(sessionId);
            userInfo = {
                dbId: sessionUser.id,
                username: sessionUser.username,
                category: sessionUser.category || null,
                peerId: data && (data.peerId || null)
            };
        }

        connectedUsers.set(socket.id, {
            id: socket.id,
            socketId: socket.id,
            dbId: userInfo.dbId,
            username: userInfo.username,
            category: userInfo.category,
            peerId: userInfo.peerId,
            joinedAt: new Date()
        });
        joinUserGroups(socket, userInfo.dbId);
        emitPresence();
        socket.emit('groups list', { groups: getGroupsForUser(userInfo.dbId) });
    });

    socket.on('chat message', (m) => io.emit('chat message', m));

    socket.on('direct message', (message) => {
        if (!message || (!message.to && !message.toDbId)) return;
        const senderUser = connectedUsers.get(socket.id) || {
            id: socket.id,
            socketId: socket.id,
            dbId: message.fromDbId || null,
            username: message.username || 'Anonymous'
        };
        const targetSocketId = String(message.to || '').trim() || findConnectedSocketIdByDbId(message.toDbId);
        const payload = {
            ...message,
            fromSocketId: socket.id,
            fromDbId: message.fromDbId || senderUser.dbId || null,
            username: message.username || senderUser.username || 'Anonymous',
            timestamp: message.timestamp || new Date().toISOString()
        };
        if (targetSocketId) {
            socket.to(String(targetSocketId)).emit('direct message', payload);
            socket.emit('direct message', { ...payload, delivered: true });
        } else {
            socket.emit('direct message', { ...payload, delivered: false, queued: true });
        }
    });

    socket.on('call user', (data) => {
        if (!data) return;
        const senderUser = connectedUsers.get(socket.id) || {
            id: socket.id,
            socketId: socket.id,
            dbId: data.fromDbId || null,
            username: data.from || 'Anonymous'
        };
        const targetSocketId = resolveSocketId(data.to, data.toDbId);
        if (!targetSocketId) {
            socket.emit('incoming call', {
                error: 'Recipient not connected',
                from: senderUser.username,
                fromDbId: senderUser.dbId,
                fromSocketId: socket.id,
                callType: data.callType || 'audio',
                timestamp: new Date().toISOString()
            });
            return;
        }
        socket.to(String(targetSocketId)).emit('incoming call', {
            from: data.from || senderUser.username || 'Anonymous',
            fromDbId: data.fromDbId || senderUser.dbId || null,
            fromSocketId: socket.id,
            callType: data.callType || 'audio',
            timestamp: new Date().toISOString()
        });
    });

    socket.on('end-call', (data) => {
        if (!data) return;
        const targetSocketId = resolveSocketId(data.to, data.toDbId);
        if (!targetSocketId) return;
        socket.to(String(targetSocketId)).emit('call-ended', {
            from: (connectedUsers.get(socket.id) && connectedUsers.get(socket.id).username) || 'Unknown',
            fromSocketId: socket.id,
            timestamp: new Date().toISOString()
        });
    });

    socket.on('missed-call', (data) => {
        if (!data) return;
        const senderUser = connectedUsers.get(socket.id) || {
            id: socket.id,
            socketId: socket.id,
            dbId: data.fromDbId || null,
            username: data.from || 'Anonymous'
        };
        const targetSocketId = resolveSocketId(data.to, data.toDbId || data.toUserDbId);
        if (!targetSocketId) return;
        socket.to(String(targetSocketId)).emit('missed-call-notification', {
            ...data,
            from: data.from || senderUser.username || 'Anonymous',
            fromDbId: data.fromDbId || senderUser.dbId || null,
            fromSocketId: socket.id,
            timestamp: data.timestamp || new Date().toISOString()
        });
    });

    socket.on('user typing', (data) => {
        if (!data || (!data.toSocketId && !data.toDbId)) return;
        const senderUser = connectedUsers.get(socket.id) || {
            id: socket.id,
            socketId: socket.id,
            dbId: data.fromDbId || null,
            username: data.username || 'Anonymous'
        };
        const targetSocketId = String(data.toSocketId || '').trim() || findConnectedSocketIdByDbId(data.toDbId);
        if (!targetSocketId) return;
        socket.to(String(targetSocketId)).emit('user typing', {
            fromDbId: senderUser.dbId || data.fromDbId || null,
            username: senderUser.username || data.username || 'Anonymous',
            isTyping: !!data.isTyping,
            fromSocketId: socket.id
        });
    });

    socket.on('delete message', (data) => {
        if (!data || !data.to) return;
        socket.to(String(data.to)).emit('delete message', data);
    });

    socket.on('drop pin', (pin) => { if (pin && typeof pin.lat === 'number' && typeof pin.lng === 'number') { pins.push(pin); io.emit('receive pin', pin); } });

    socket.on('create group', (data, ack) => {
        try {
            const sender = connectedUsers.get(socket.id);
            if (!sender || !sender.dbId) {
                if (typeof ack === 'function') ack({ success: false, error: 'Unauthorized' });
                return;
            }

            const name = String((data && data.name) || '').trim();
            if (!name) {
                if (typeof ack === 'function') ack({ success: false, error: 'Group name required' });
                return;
            }

            const rawMembers = Array.isArray(data && data.members) ? data.members : [];
            const members = new Set(rawMembers.map(m => String(m)).filter(Boolean));
            members.add(String(sender.dbId));

            const groupId = generateId(8);
            const group = {
                id: groupId,
                name: name.slice(0, 60),
                ownerDbId: String(sender.dbId),
                members,
                createdAt: new Date().toISOString()
            };

            groups.set(groupId, group);

            members.forEach((memberDbId) => {
                const memberSocketId = findConnectedSocketIdByDbId(memberDbId);
                if (!memberSocketId) return;
                const memberSocket = io.sockets.sockets.get(memberSocketId);
                if (!memberSocket) return;
                memberSocket.join(`group:${groupId}`);
                memberSocket.emit('groups list', { groups: getGroupsForUser(memberDbId) });
            });

            if (typeof ack === 'function') ack({ success: true, group: toSocketPayloadGroup(group) });
        } catch (err) {
            if (typeof ack === 'function') ack({ success: false, error: 'Could not create group' });
        }
    });

    socket.on('request groups', (data) => {
        const sender = connectedUsers.get(socket.id);
        const dbId = (sender && sender.dbId) || (data && data.dbId);
        socket.emit('groups list', { groups: getGroupsForUser(dbId) });
    });

    socket.on('send group message', (data) => {
        const sender = connectedUsers.get(socket.id);
        if (!sender || !sender.dbId || !data || !data.groupId) return;
        const group = groups.get(String(data.groupId));
        if (!group || !group.members.has(String(sender.dbId))) return;

        const payload = {
            id: data.id || `gmsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            groupId: group.id,
            groupName: group.name,
            username: sender.username || data.username || 'Anonymous',
            fromDbId: sender.dbId,
            message: data.message,
            caption: data.caption || null,
            replyTo: data.replyTo || null,
            mediaType: data.mediaType || null,
            type: data.type || 'text',
            timestamp: data.timestamp || new Date().toLocaleTimeString()
        };

        io.to(`group:${group.id}`).emit('group message', payload);
    });

    socket.on('add group members', (data, ack) => {
        const sender = connectedUsers.get(socket.id);
        if (!sender || !sender.dbId || !data || !data.groupId) {
            if (typeof ack === 'function') ack({ success: false, error: 'Invalid request' });
            return;
        }

        const group = groups.get(String(data.groupId));
        if (!group) {
            if (typeof ack === 'function') ack({ success: false, error: 'Group not found' });
            return;
        }
        if (!group.members.has(String(sender.dbId))) {
            if (typeof ack === 'function') ack({ success: false, error: 'Not a member' });
            return;
        }

        const membersToAdd = Array.isArray(data.members) ? data.members : [];
        membersToAdd.forEach((member) => group.members.add(String(member)));

        group.members.forEach((memberDbId) => {
            const memberSocketId = findConnectedSocketIdByDbId(memberDbId);
            if (!memberSocketId) return;
            const memberSocket = io.sockets.sockets.get(memberSocketId);
            if (!memberSocket) return;
            memberSocket.join(`group:${group.id}`);
            memberSocket.emit('groups list', { groups: getGroupsForUser(memberDbId) });
        });

        io.to(`group:${group.id}`).emit('group updated', toSocketPayloadGroup(group));
        if (typeof ack === 'function') ack({ success: true, group: toSocketPayloadGroup(group) });
    });

    socket.on('leave group', (data, ack) => {
        const sender = connectedUsers.get(socket.id);
        if (!sender || !sender.dbId || !data || !data.groupId) {
            if (typeof ack === 'function') ack({ success: false, error: 'Invalid request' });
            return;
        }

        const group = groups.get(String(data.groupId));
        if (!group) {
            if (typeof ack === 'function') ack({ success: false, error: 'Group not found' });
            return;
        }

        group.members.delete(String(sender.dbId));
        socket.leave(`group:${group.id}`);

        if (group.members.size === 0) {
            groups.delete(group.id);
            if (typeof ack === 'function') ack({ success: true, deleted: true });
            return;
        }

        if (group.ownerDbId === String(sender.dbId)) {
            group.ownerDbId = Array.from(group.members)[0];
        }

        group.members.forEach((memberDbId) => {
            const memberSocketId = findConnectedSocketIdByDbId(memberDbId);
            if (!memberSocketId) return;
            const memberSocket = io.sockets.sockets.get(memberSocketId);
            if (!memberSocket) return;
            memberSocket.emit('groups list', { groups: getGroupsForUser(memberDbId) });
        });

        if (typeof ack === 'function') ack({ success: true, group: toSocketPayloadGroup(group) });
    });

    socket.on('disconnect', () => {
        connectedUsers.delete(socket.id);
        io.emit('user left', getPresencePayload());
    });
});

app.get('/api/pins', (req, res) => res.json(pins));
app.post('/api/pins', (req, res) => { const { lat, lng, user: uname, category } = req.body; if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'Invalid coordinates' }); const pin = { lat, lng, user: uname || 'Anonymous', category: category || 'user', timestamp: new Date().toLocaleTimeString() }; pins.push(pin); io.emit('receive pin', pin); return res.status(201).json({ message: 'Pin created', pin }); });

app.get('/api/groups', (req, res) => {
    const sessionId = req.query.sessionId || req.query.session;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const sessionUser = sessions.get(sessionId);
    return res.json({ success: true, groups: getGroupsForUser(sessionUser.id) });
});

// 404
app.use((req, res) => res.status(404).render('404', { title: 'Not found' }));

const listenHost = process.env.HOST && process.env.HOST.trim() ? process.env.HOST.trim() : '0.0.0.0';
server.listen(PORT, listenHost, () => { const localIP = getAdvertisedHost(); app.locals.localIP = localIP; app.locals.protocol = useHttps ? 'https' : 'http'; console.log(`Server listening: ${app.locals.protocol}://localhost:${PORT}`); console.log(`Network: ${app.locals.protocol}://${localIP}:${PORT}`); });
