# Setup Instructions for Foreman App

## Prerequisites: Install Node.js

You need to install Node.js which includes npm (Node Package Manager).

### Option 1: Download from Official Website (Recommended)
1. Go to https://nodejs.org/
2. Click "LTS" (Long Term Support) - currently v20.x
3. Download the Windows Installer (.msi)
4. Run the installer and follow the setup wizard
5. Accept all defaults (include npm in the installation)
6. Click "Install"
7. Restart your computer

### Option 2: Using Windows Package Manager (if installed)
```powershell
winget install OpenJS.NodeJS
```

### Option 3: Using Chocolatey (if installed)
```powershell
choco install nodejs
```

## After Installation

### 1. Verify Installation
Open PowerShell and run:
```powershell
node --version
npm --version
```

Both should show version numbers (e.g., v20.10.0 and 10.2.3)

### 2. Navigate to Project
```powershell
cd "c:\Users\ayuba\OneDrive\Desktop\project construction\foreman-app"
```

### 3. Install Dependencies
```powershell
npm install
```
This will create a `node_modules` folder with all required packages.

### 4. Start the Server
```powershell
npm start
```

You should see:
```
Server running on http://localhost:3000
```

### 5. Access the Website
Open your browser and go to:
```
http://localhost:3000
```

## Project Structure
```
foreman-app/
├── server.js                 # Express server with Socket.io
├── package.json             # Dependencies
├── .env                     # Environment variables
├── .gitignore              # Git ignore file
├── index.html              # Standalone HTML version (no npm needed)
├── public/
│   ├── css/
│   │   └── style.css       # Styling
│   └── js/
│       └── main.js         # Client-side logic
└── views/
    ├── index.ejs           # Home page
    ├── signup.ejs          # Signup form
    ├── dashboard.ejs       # Main app
    └── 404.ejs             # Error page
```

## Features
✅ Google Earth/Maps integration with satellite view
✅ Real-time chat messaging (Socket.io) - one-on-one conversations
✅ Location pin dropping & sharing on live map
✅ User presence tracking and selection
✅ Call signaling (audio & video placeholders)
✅ Responsive design for mobile & desktop
✅ Session management with email/phone validation
✅ User authentication (signup/login)
✅ Foreman/User role-based interface
✅ Message history per conversation

## Quick Start with START.bat

Sinbvc mply double-click `START.bat` to automatically:
1. Check if Node.js is installed
2. Install dependencies
3. Start the server
4. Open http://localhost:3000

## Troubleshooting

### "npm: The term 'npm' is not recognized"
- Node.js is not installed or not in PATH
+- **Solution**: Install Node.js from https://nodejs.org/

### Port 3000 already in use
- Another application is using port 3000
- **Solution**: Change PORT in `.env` file or kill the process using the port

### Module not found errors
- Dependencies aren't installed
- **Solution**: Run `npm install` again

### CORS8709-# errors
- Socket.io CORS is already configured for all origins
- If issues persist, check `.env` configuration

## Environment Variables
Edit `.env` file to configure:
```
PORT=3000
GOOGLE_EARTH_API_KEY=your_api_key_here
```

## Setting Up Google Earth/Maps API

### Step 1: Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click "Select a Project" → "New Project"
3. Enter project name: "Foreman App"
4. Click "Create"

### Step 2: Enable Required APIs
1. In Cloud Console, search for "Maps JavaScript API"
2. Click on it and press "Enable"
3. Search for "Street View Static API" and enable it
4. (Optional) Enable "Earth Engine API" for advanced features

### Step 3: Create API Key
1. Go to "Credentials" in left menu
2. Click "Create Credentials" → "API Key"
3. Copy the generated API key
4. Click "Restrict Key" to set security:
   - Choose "HTTP referrers (web sites)"
   - Add `localhost:3000` and your production domain
   - Click "Save"

### Step 4: Add to .env File
1. Open `.env` file in the project
2. Replace the GOOGLE_EARTH_API_KEY value:
```
GOOGLE_EARTH_API_KEY=YOUR_API_KEY_HERE
```
3. Save the file
4. Restart the server

### Step 5: Test the Map
1. Sign in and go to dashboard
2. You should see an interactive satellite map
3. Drop pins to test location sharing

## Map Features
✅ Satellite/Hybrid/Roadmap view switching
✅ Zoom and pan controls
✅ Street view integration
✅ Pin dropping with color coding
✅ Location markers for foremen (yellow) and users (red)
✅ Full screen mode support

## Technology Stack
- **Backend**: Node.js, Express.js
- **Real-time**: Socket.io
- **Frontend**: EJS, HTML5, CSS3, JavaScript
- **Authentication**: Session-based
- **APIs**: Google Maps/Earth API (optional)

## Development

### Run in Development Mode
```powershell
npm start
```

### Stop the Server
Press `Ctrl + C` in the terminal

### View Logs
The server logs all connections, messages, and events to console

## Next Steps
1. Install Node.js from https://nodejs.org/
2. Run `npm install` to install dependencies
3. Run `npm start` to start the server
4. Visit http://localhost:3000 in your browser
5. Sign up as Foreman or User to access the dashboard

## Alternative: No-Install Version
If you don't want to install Node.js, open `index.html` directly in your browser for a standalone version (no real-time features, local-only)
