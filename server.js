require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Database Connection Test
pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ Database connection failed:', err.message);
    }
    console.log('✅ Connected to Neon Database');
    release();
});

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" } 
});

// --- API ROUTES ---

// 1. Register a new room
app.post('/api/register', async (req, res) => {
    const { roomCode, userA, userB, letterA, letterB, song } = req.body;
    try {
        await pool.query(
            `INSERT INTO couples (room_code, user_a_name, user_b_name, letter_for_a, letter_for_b, selected_song, pulse_count) 
             VALUES ($1, $2, $3, $4, $5, $6, 0)`,
            [roomCode.toUpperCase(), userA, userB, letterA, letterB, song]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("Registration Error:", err.message);
        res.status(400).json({ error: "Room code already exists or data missing." });
    }
});

// 2. Login to a room
app.post('/api/login', async (req, res) => {
    const { roomCode, myName } = req.body;
    try {
        const result = await pool.query('SELECT * FROM couples WHERE room_code = $1', [roomCode.toUpperCase()]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Room code not found." });
        }

        const couple = result.rows[0];
        let letter = "";
        
        // Show the letter intended FOR the person logging in
        if (myName.toLowerCase() === couple.user_a_name.toLowerCase()) {
            letter = couple.letter_for_a; 
        } else if (myName.toLowerCase() === couple.user_b_name.toLowerCase()) {
            letter = couple.letter_for_b; 
        } else {
            return res.status(403).json({ error: "Name does not match this room." });
        }

        res.json({ 
            letter: letter, 
            song: couple.selected_song,
            pulseCount: couple.pulse_count 
        });
    } catch (err) {
        console.error("Login Error:", err.message);
        res.status(500).json({ error: "Internal server error." });
    }
});

// --- SOCKET.IO LOGIC ---

io.on('connection', (socket) => {
    
    socket.on('join-room', (room) => {
        socket.join(room);
        console.log(`User joined room: ${room}`);

        // Count how many people are in the room
        const clients = io.sockets.adapter.rooms.get(room);
        const numClients = clients ? clients.size : 0;

        // If 2 people are in the room, tell them both to update their UI
        if (numClients >= 2) {
            io.to(room).emit('update-ui', { isPartnerPresent: true });
            console.log(`Room ${room} is now full. Partners connected.`);
        }
    });

    socket.on('send-pulse', async ({ roomId, x, y }) => {
        // 1. Broadcast ripple to the partner immediately
        socket.to(roomId).emit('receive-pulse', { x, y });

        // 2. Update the Database
        try {
            const result = await pool.query(
                'UPDATE couples SET pulse_count = pulse_count + 1 WHERE room_code = $1 RETURNING pulse_count', 
                [roomId.toUpperCase()]
            );
            
            // 3. Sync the new count to BOTH partners
            if (result.rows.length > 0) {
                io.to(roomId).emit('update-count', result.rows[0].pulse_count);
            }
        } catch (err) {
            console.error("Database Pulse Error:", err);
        }
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Pulse Server is running!`);
    console.log(`📡 Local: http://localhost:${PORT}`);
    console.log(`💓 Listening for pulses...\n`);
});