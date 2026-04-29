# Foreman User App - Google Earth Collaboration Platform

A real-time collaboration platform for foremen and users to communicate and share locations via Google Earth.

## Features

- User signup and authentication
- Real-time chat messaging
- Location pin dropping and sharing
- WebRTC call support (placeholder)
- Responsive design

## Prerequisites

- Node.js (v14 or higher)
- npm

## Installation

1. Navigate to the project directory:
   ```bash
   cd foreman-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with:
   ```
   PORT=3000
   GOOGLE_EARTH_API_KEY=your_api_key_here
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. Open your browser and navigate to `http://localhost:3000`

## Usage

1. **Sign Up**: Create an account as either a Foreman or User
2. **Dashboard**: Access the collaboration dashboard
3. **Chat**: Send real-time messages to other connected users
4. **Pin Dropping**: Share your location with others
5. **Calling**: Initiate voice/video calls (requires WebRTC setup)

## Project Structure

```
foreman-app/
├── server.js           # Express server and Socket.io setup
├── package.json        # Dependencies
├── .env                # Environment variables
├── views/              # EJS templates
│   ├── index.ejs       # Home page
│   ├── signup.ejs      # Signup form
│   └── dashboard.ejs   # Main collaboration page
└── public/
    ├── css/
    │   └── style.css   # Styling
    └── js/
        └── main.js     # Client-side logic
```

## Technologies Used

- **Backend**: Node.js, Express.js
- **Real-time**: Socket.io
- **Frontend**: EJS, HTML, CSS, JavaScript
- **APIs**: Google Maps API

## Future Enhancements

- Database integration (MongoDB/PostgreSQL)
- Password encryption with bcrypt
- JWT authentication
- Full WebRTC implementation
- Video call functionality
- User presence indicators
