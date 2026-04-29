const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const socketIo = require('socket.io');
require('dotenv').config(); // Load environment variables

const app = express();

// Try to load HTTPS certificate, fallback to HTTP if not available
let server;
let protocol = 'http';
const certPath = path.join(__dirname, 'server-cert.pfx');

if (fs.existsSync(certPath)) {
    try {
        const pfx = fs.readFileSync(certPath);
        const httpsOptions = {
            pfx: pfx,
            passphrase: 'foreman2024'
        };
        server = https.createServer(httpsOptions, app);
        protocol = 'https';
        console.log('✓ HTTPS enabled');
    } catch (err) {
        console.warn('Failed to load HTTPS certificate, falling back to HTTP:', err.message);
        server = http.createServer(app);
    }
} else {
    console.warn('No HTTPS certificate found, using HTTP');
    server = http.createServer(app);
}

const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
}); // Initialize Socket.io for chat/pins

// Optional: Google Earth Engine integration
let ee;
let eeInitialized = false;
try {
    ee = require('@google/earthengine');
} catch (err) {
    console.warn('Optional package @google/earthengine not installed. Earth Engine endpoints disabled.');
}

// --- Configuration ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- Middleware for Logging ---
app.use((req, res, next) => {
    console.log(`${new Date().toLocaleString()} - ${req.method} ${req.path}`);
    next();
});

// --- Simple Mock User Database (Replace with MongoDB/SQL) ---
// Persist user signups to `data/users.json` so accounts survive restarts.
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
let users = []; // Store: { id, username, email, phone, password, category, createdAt }
const sessions = new Map();

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadUsersFromDisk() {
    try {
        ensureDataDir();
        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(USERS_FILE, '[]', 'utf8');
            return [];
        }
        const raw = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(raw || '[]');
    } catch (err) {
        console.warn('Could not load users.json, starting with empty user list', err);
        return [];
    }
}

function saveUsersToDisk() {
    try {
        ensureDataDir();
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (err) {
        console.error('Failed to save users.json', err);
    }
}

// initialize users from disk
users = loadUsersFromDisk();

// Initialize Earth Engine if available and private-key exists
function initEarthEngine() {
    if (!ee) return;
    const keyPath = path.join(__dirname, 'private-key.json');
    if (!fs.existsSync(keyPath)) {
        console.warn('Earth Engine private-key.json not found. Skipping Earth Engine initialization.');
        return;
    }
    try {
        const privateKey = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        ee.data.authenticateViaPrivateKey(privateKey, () => {
            ee.initialize(null, null, () => {
                eeInitialized = true;
                console.log('Google Earth Engine initialized');
            }, (err) => {
                console.error('Earth Engine initialize error:', err);
            });
        }, (err) => {
            console.error('Earth Engine authentication failed:', err);
        });
    } catch (err) {
        console.error('Earth Engine init exception:', err);
    }
}

initEarthEngine();

// --- Authentication Middleware ---
const requireAuth = (req, res, next) => {
    const sessionId = req.query.session || req.body.session;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.redirect('/');
    }
    req.user = sessions.get(sessionId);
    next();
};

// --- Routes ---
// Home page
app.get('/', (req, res) => {
    res.render('index');
});

// Signup page
app.get('/signup', (req, res) => {
    res.render('signup');
});

// Login page
app.get('/login', (req, res) => {
    res.render('login', { message: req.query.message || null });
});

// Handle sign-up
app.post('/signup', (req, res) => {
    const { username, email, phone, password, category, location } = req.body;
    
    // Validate input
    if (!username || !email || !phone || !password || !category) {
        return res.status(400).send('Missing required fields');
    }

    // Require location for foremen
    if (category === 'foreman' && !location) {
        return res.status(400).send('Location is required for foremen');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).send('Invalid email format');
    }

    // Validate phone number (at least 10 digits)
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
        return res.status(400).send('Invalid phone number. Please enter a valid phone number.');
    }
    
    // Check if email already exists
    if (users.some(u => u.email === email)) {
        return res.status(400).send('An account with this email already exists. <a href="/login">Login here</a>');
    }

    // Check if phone already exists
    if (users.some(u => u.phone.replace(/\D/g, '') === phoneDigits)) {
        return res.status(400).send('An account with this phone number already exists. <a href="/login">Login here</a>');
    }

    // Check if username already exists
    if (users.some(u => u.username === username)) {
        return res.status(400).send('Username is already taken. Please choose a different username.');
    }

    // Create new user
    const userId = Date.now().toString();
    const user = {
        id: userId,
        username: username,
        email: email,
        phone: phone,
        password: password, // In production, hash this with bcrypt
        category: category,
        location: location || null,
        createdAt: new Date()
    };
    users.push(user);
    // Persist users to disk so signups survive server restarts
    saveUsersToDisk();
    
    // Create session
    const sessionId = Date.now().toString();
    sessions.set(sessionId, user);
    
    console.log(`New ${category} registered: ${username} (${email})`);
    res.redirect(`/dashboard?session=${sessionId}`);
});

// Handle login
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).render('login', { message: 'Email and password are required' });
    }

    // Find user by email
    const user = users.find(u => u.email === email);

    if (!user) {
        return res.status(401).render('login', { message: 'Email not found. Please check your email or sign up.' });
    }

    // Check password
    if (user.password !== password) {
        return res.status(401).render('login', { message: 'Incorrect password. Please try again.' });
    }

    // Create session
    const sessionId = Date.now().toString();
    sessions.set(sessionId, user);

    console.log(`User logged in: ${user.username} (${email})`);
    res.redirect(`/dashboard?session=${sessionId}`);
});

// Main dashboard (requires authentication)
app.get('/dashboard', requireAuth, (req, res) => {
    const sessionId = req.query.session;
    // Preload the contact list so the client can render immediately (even if fetch fails)
    const safeUsers = users.map(u => ({
        id: u.id,
        username: u.username,
        category: u.category,
        createdAt: u.createdAt
    }));
    res.render('dashboard', {
        googleEarthApiKey: process.env.GOOGLE_EARTH_API_KEY,
        user: req.user,
        sessionId: sessionId,
        allUsers: safeUsers
    });
});

// Settings page
app.get('/settings', requireAuth, (req, res) => {
    const sessionId = req.query.session;
    res.render('settings', {
        user: req.user,
        sessionId: sessionId
    });
});

// Logout
app.get('/logout', (req, res) => {
    const sessionId = req.query.session;
    if (sessionId) {
        sessions.delete(sessionId);
    }
    res.redirect('/');
});

// 404 Handler (moved to bottom so API routes above can be reached)

// --- Simple REST API ---
// Note: This is a minimal in-memory API useful for local testing.
app.get('/api/status', (req, res) => {
    res.json({ ok: true, uptime: process.uptime(), timestamp: new Date() });
});

// Health check endpoint for load balancers / quick checks
app.get('/health', (req, res) => {
    try {
        return res.json({
            ok: true,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            usersConnected: connectedUsers.size
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
});

// Update profile API
app.post('/api/update-profile', (req, res) => {
    const { username, email, phone, location, bio, sessionId } = req.body;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    const user = sessions.get(sessionId);
    const userIndex = users.findIndex(u => u.id === user.id);
    
    if (userIndex === -1) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Update user data
    users[userIndex].username = username || users[userIndex].username;
    users[userIndex].email = email || users[userIndex].email;
    users[userIndex].phone = phone || users[userIndex].phone;
    users[userIndex].location = location || users[userIndex].location || null;
    users[userIndex].bio = bio || '';
    users[userIndex].bio = bio || '';
    
    // Update session
    sessions.set(sessionId, users[userIndex]);
    
    // Save to disk
    saveUsersToDisk();
    
    res.json({ success: true, user: users[userIndex] });
});

// Change password API
app.post('/api/change-password', (req, res) => {
    const { currentPassword, newPassword, sessionId } = req.body;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    const user = sessions.get(sessionId);
    const userIndex = users.findIndex(u => u.id === user.id);
    
    if (userIndex === -1) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Verify current password
    if (users[userIndex].password !== currentPassword) {
        return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }
    
    // Update password
    users[userIndex].password = newPassword;
    
    // Save to disk
    saveUsersToDisk();
    
    res.json({ success: true });
});

// Delete account API
app.post('/api/delete-account', (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    
    const user = sessions.get(sessionId);
    const userIndex = users.findIndex(u => u.id === user.id);
    
    if (userIndex !== -1) {
        users.splice(userIndex, 1);
        saveUsersToDisk();
    }
    
    sessions.delete(sessionId);
    res.json({ success: true });
});

// Return list of users (sanitize passwords)
app.get('/api/users', (req, res) => {
    const safe = users.map(u => ({ id: u.id, username: u.username, email: u.email, phone: u.phone, category: u.category, createdAt: u.createdAt }));
    res.json(safe);
});

// Get all users including offline ones (for contact list)
app.get('/api/all-users', (req, res) => {
    const safe = users.map(u => ({ 
        id: u.id, 
        username: u.username, 
        email: u.email,
        phone: u.phone,
        category: u.category,
        location: u.location || null,
        bio: u.bio || null,
        createdAt: u.createdAt 
    }));
    res.json({ users: safe, total: safe.length });
});

app.get('/api/users/:id', (req, res) => {
    const u = users.find(x => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const safe = { id: u.id, username: u.username, email: u.email, phone: u.phone, category: u.category, createdAt: u.createdAt };
    res.json(safe);
});

// Create user via API (same validation as signup form)
app.post('/api/users', (req, res) => {
    const { username, email, phone, password, category } = req.body;
    if (!username || !email || !phone || !password || !category) return res.status(400).json({ error: 'Missing required fields' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email' });
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10) return res.status(400).json({ error: 'Invalid phone' });
    if (users.some(u => u.email === email)) return res.status(409).json({ error: 'Email already exists' });
    if (users.some(u => u.phone.replace(/\D/g, '') === phoneDigits)) return res.status(409).json({ error: 'Phone already exists' });
    if (users.some(u => u.username === username)) return res.status(409).json({ error: 'Username already exists' });
    const userId = Date.now().toString();
    const newUser = { id: userId, username, email, phone, password, category, createdAt: new Date() };
    users.push(newUser);
    // Persist users to disk
    saveUsersToDisk();
    const sessionId = Date.now().toString();
    sessions.set(sessionId, newUser);
    res.status(201).json({ message: 'User created', user: { id: newUser.id, username: newUser.username, email: newUser.email, category: newUser.category }, sessionId });
});

// Auth via API
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = users.find(u => u.email === email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
    const sessionId = Date.now().toString();
    sessions.set(sessionId, user);
    res.json({ message: 'Login successful', sessionId, user: { id: user.id, username: user.username, email: user.email, category: user.category } });
});

// Pins API
app.get('/api/pins', (req, res) => {
    res.json(pins);
});

app.post('/api/pins', (req, res) => {
    const { lat, lng, user: uname, category } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') return res.status(400).json({ error: 'Invalid coordinates' });
    const pin = { lat, lng, user: uname || 'Anonymous', category: category || 'user', timestamp: new Date().toLocaleTimeString() };
    pins.push(pin);
    io.emit('receive pin', pin);
    res.status(201).json({ message: 'Pin created', pin });
});

// --- Reviews API ---
// In-memory reviews store: { id, foremanId, reviewerId, reviewerName, rating, comment, timestamp }
const reviews = [];

// Get reviews for a foreman
app.get('/api/reviews/:foremanId', (req, res) => {
    const foremanReviews = reviews.filter(r => r.foremanId === req.params.foremanId);
    const avg = foremanReviews.length
        ? (foremanReviews.reduce((s, r) => s + r.rating, 0) / foremanReviews.length).toFixed(1)
        : null;
    res.json({ reviews: foremanReviews, averageRating: avg, total: foremanReviews.length });
});

// Submit a review for a foreman
app.post('/api/reviews', (req, res) => {
    const { foremanId, rating, comment, sessionId: sid } = req.body;
    if (!sid || !sessions.has(sid)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const reviewer = sessions.get(sid);
    if (reviewer.id === foremanId) {
        return res.status(400).json({ error: 'Cannot review yourself' });
    }
    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    // One review per reviewer per foreman — update if exists
    const existing = reviews.findIndex(r => r.foremanId === foremanId && r.reviewerId === reviewer.id);
    const reviewEntry = {
        id: existing >= 0 ? reviews[existing].id : Date.now().toString(),
        foremanId,
        reviewerId: reviewer.id,
        reviewerName: reviewer.username,
        rating: ratingNum,
        comment: (comment || '').trim().slice(0, 500),
        timestamp: new Date().toISOString()
    };
    if (existing >= 0) {
        reviews[existing] = reviewEntry;
    } else {
        reviews.push(reviewEntry);
    }
    io.emit('review updated', { foremanId });
    res.status(201).json({ message: 'Review saved', review: reviewEntry });
});

// --- Google Earth Engine: Soil Moisture / Water Balance Index endpoint ---
// Example: /api/soil-moisture?latitude=40.7128&longitude=-74.0060&start_date=2023-10-03&end_date=2024-10-03
app.get('/api/soil-moisture', (req, res) => {
    if (!ee || !eeInitialized) {
        return res.status(503).json({ error: 'Earth Engine not initialized. Place private-key.json in project root and restart the server.' });
    }

    const { latitude, longitude, start_date = '2023-10-03', end_date = '2024-10-03', buffer_km = 100 } = req.query;
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: 'latitude and longitude query parameters are required and must be numbers' });
    }

    const point = ee.Geometry.Point([lng, lat]);
    const region = point.buffer(Number(buffer_km) * 1000);

    try {
        const ET = ee.ImageCollection('MODIS/061/MOD16A2GF')
            .filterDate(start_date, end_date)
            .select('ET')
            .mean()
            .clip(region);

        const precipitation = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
            .filterDate(start_date, end_date)
            .select('precipitation')
            .mean()
            .clip(region);

        const waterBalanceIndex = ET.subtract(precipitation).rename('WBI');

        // Compute percentiles using reduceRegion -> evaluate
        waterBalanceIndex.reduceRegion({
            reducer: ee.Reducer.percentile([2, 98]),
            geometry: region,
            scale: 5566,
            maxPixels: 1e9
        }).evaluate((stats, err) => {
            if (err) {
                console.error('reduceRegion error:', err);
                return res.status(500).json({ error: 'Failed to compute statistics', details: err });
            }

            const visParams = {
                min: stats['WBI_p2'],
                max: stats['WBI_p98'],
                palette: ['red', 'white', 'blue']
            };

            // Use getMap to obtain map id/token
            waterBalanceIndex.getMap(visParams, (mapObj) => {
                // mapObj typically contains a urlTemplate or similar field depending on SDK version
                return res.json({ map: mapObj });
            }, (err2) => {
                console.error('getMap error:', err2);
                return res.status(500).json({ error: 'Failed to get map tiles', details: err2 });
            });
        });
    } catch (ex) {
        console.error('Soil moisture endpoint exception:', ex);
        return res.status(500).json({ error: 'Internal server error', details: ex.message });
    }
});

// --- Real-time Communication (Socket.io) ---
const connectedUsers = new Map();
// In-memory pins store (lat/lng/user/category/timestamp)
const pins = [];

io.on('connection', (socket) => {
    console.log(`[${new Date().toLocaleString()}] User connected: ${socket.id}`);

    // User joins
    socket.on('user join', (data) => {
        // Remove any old connections for this user (by dbId) to prevent duplicates
        if (data.id || data.dbId) {
            const userDbId = data.id || data.dbId;
            for (const [sid, userInfo] of connectedUsers.entries()) {
                if (userInfo.dbId === userDbId && sid !== socket.id) {
                    console.log(`Removing old socket ${sid} for user ${userInfo.username}`);
                    connectedUsers.delete(sid);
                }
            }
        }
        
        // Store mapping from socket.id -> user info (include DB id and peer id for calls)
        connectedUsers.set(socket.id, {
            socketId: socket.id,
            dbId: data.id || data.dbId || null,
            username: data.username,
            category: data.category,
            peerId: data.peerId || null,
            joinedAt: new Date()
        });

        const userCount = connectedUsers.size;
        console.log(`User joined: ${data.username} (Total users: ${userCount})`);

        // Notify all users with socketId and dbId so clients can map correctly
        io.emit('user joined', {
            userCount: userCount,
            users: Array.from(connectedUsers.values()).map(u => ({ id: u.socketId, dbId: u.dbId, username: u.username, category: u.category, peerId: u.peerId, joinedAt: u.joinedAt }))
        });
    });

    // 1. Chat Messaging (Broadcast to all)
    socket.on('chat message', (msg) => {
        const user = connectedUsers.get(socket.id);
        const messageData = {
            username: user ? user.username : 'Anonymous',
            message: msg,
            timestamp: new Date().toLocaleTimeString()
        };
        
        io.emit('chat message', messageData);
        console.log(`Chat: ${messageData.username} - ${msg}`);
    });

    // Direct Messages (One-to-one)
    socket.on('direct message', (data) => {
        console.log('=== SERVER RECEIVED DIRECT MESSAGE ===');
        console.log('Data received:', JSON.stringify(data, null, 2));
        
        // data.to is expected to be the recipient's socket id
        const fromUser = connectedUsers.get(socket.id) || { username: 'Anonymous' };
        let targetSocketId = data.to;
        if (!targetSocketId) {
            for (const [sid, info] of connectedUsers.entries()) {
                if (info.dbId && info.dbId === data.to) {
                    targetSocketId = sid;
                    break;
                }
            }
        }
        const payload = {
            id: data.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            username: fromUser.username,
            fromDbId: fromUser.dbId || null,
            fromSocketId: socket.id,
            toSocketId: targetSocketId,
            message: data.message,
            timestamp: new Date().toLocaleTimeString(),
            mediaType: data.mediaType || null,
            isMedia: data.isMedia || false,
            type: data.type || 'text',
            locationUrl: data.locationUrl || null,
            lat: data.lat || null,
            lng: data.lng || null
        };
        
        console.log('=== SERVER SENDING PAYLOAD ===');
        console.log('Payload:', JSON.stringify(payload, null, 2));

        const recipientSocket = targetSocketId ? io.sockets.sockets.get(targetSocketId) : null;
        if (recipientSocket) {
            // send only to recipient
            io.to(targetSocketId).emit('direct message', payload);
            // also send a copy to sender for acknowledgement (clients can ignore duplicates)
            socket.emit('direct message', payload);
            console.log(`Direct Message from ${fromUser.username} (${socket.id}) to ${targetSocketId}: ${data.message}`);
        } else {
            // Recipient not connected
            socket.emit('direct message', { error: 'Recipient not connected', ...payload });
            console.log(`Direct Message failed: recipient ${targetSocketId || data.to} not connected`);
        }
    });

    // Delete message (propagate to recipient)
    socket.on('delete message', (data) => {
        const fromUser = connectedUsers.get(socket.id) || { username: 'Anonymous' };
        const payload = {
            messageId: data.messageId,
            fromDbId: fromUser.dbId || null,
            fromSocketId: socket.id,
            toSocketId: data.to
        };
        const recipientSocket = io.sockets.sockets.get(data.to);
        if (recipientSocket) {
            io.to(data.to).emit('delete message', payload);
            socket.emit('delete message', payload); // acknowledge
            console.log(`Delete message ${data.messageId} from ${fromUser.username} -> ${data.to}`);
        } else {
            socket.emit('delete message', { error: 'Recipient not connected', ...payload });
            console.log(`Delete message failed: recipient ${data.to} not connected`);
        }
    });

    // 2. Pin Dropping (Location Sharing)
    socket.on('drop pin', (data) => {
        const user = connectedUsers.get(socket.id);
        const pinData = {
            ...data,
            user: user ? user.username : 'Anonymous',
            timestamp: new Date().toLocaleTimeString()
        };
        
        // Persist pin server-side (in-memory)
        pins.push(pinData);

        // Broadcast the pin coordinates to all users
        io.emit('receive pin', pinData);
        console.log(`Pin dropped by ${pinData.user}:`, data);
    });
    
    // 3. Simple Call Signaling (Placeholder for WebRTC)
    socket.on('call user', (data) => {
        const user = connectedUsers.get(socket.id) || { username: 'Anonymous' };
        const payload = {
            from: user.username,
            fromDbId: user.dbId || null,
            fromSocketId: socket.id,
            toSocketId: data.to || data.toId,
            type: data.type || data.callType || 'audio',
            timestamp: new Date().toLocaleTimeString()
        };

        const target = data.to || data.toId;
        if (target && io.sockets.sockets.get(target)) {
            io.to(target).emit('incoming call', payload);
            socket.emit('incoming call', payload); // echo for sender UI
            console.log(`Call initiated by ${user.username} to ${target}`);
        } else {
            socket.emit('incoming call', { error: 'Recipient not connected', ...payload });
            console.log(`Call initiation failed: recipient ${target} not connected`);
        }
    });
    
    // Missed call notification (for offline users)
    socket.on('missed-call', (data) => {
        const fromUser = connectedUsers.get(socket.id) || { username: 'Anonymous' };
        console.log(`Missed call from ${fromUser.username} to user ID ${data.to}`);
        
        // Find recipient's socket by dbId
        let targetSocketId = null;
        for (const [sid, info] of connectedUsers.entries()) {
            if (info.dbId && info.dbId === data.to) {
                targetSocketId = sid;
                break;
            }
        }
        
        const payload = {
            type: 'missed-call',
            from: fromUser.username,
            fromDbId: fromUser.dbId || data.fromDbId,
            message: data.message || `Missed call from ${fromUser.username}`,
            timestamp: data.timestamp || new Date().toLocaleTimeString()
        };
        
        // If they come online later, they'll see it in their message history
        // For now, if they're actually online but peer isn't ready, send notification
        if (targetSocketId) {
            io.to(targetSocketId).emit('missed-call-notification', payload);
            console.log(`Missed call notification sent to ${targetSocketId}`);
        } else {
            console.log(`User ${data.to} is offline, will be notified when they come online`);
        }
    });

    // User typing indicator
    socket.on('user typing', (data) => {
        const user = connectedUsers.get(socket.id);
        socket.broadcast.emit('user typing', {
            username: user ? user.username : 'Anonymous',
            isTyping: data.isTyping
        });
    });
    
    // End call notification
    socket.on('end-call', (data) => {
        console.log('End call signal from', socket.id, 'to', data.to);
        if (data.to && io.sockets.sockets.get(data.to)) {
            io.to(data.to).emit('call-ended', { from: socket.id });
        }
    });

    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        connectedUsers.delete(socket.id);
        
        const userCount = connectedUsers.size;
        console.log(`User disconnected: ${user ? user.username : 'Unknown'} (Remaining users: ${userCount})`);
        
        io.emit('user left', {
            username: user ? user.username : 'Anonymous',
            userCount: userCount,
            users: Array.from(connectedUsers.values())
        });
    });
});

// 404 Handler
app.use((req, res) => {
    res.status(404).render('404', { title: 'Page Not Found' });
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const getLocalIP = () => {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return 'localhost';
    };
    const localIP = getLocalIP();
    console.log(`Server running on ${protocol}://localhost:${PORT}`);
    console.log(`Network access: ${protocol}://${localIP}:${PORT}`);
});
