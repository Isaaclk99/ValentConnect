require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// 1. CORS CONFIGURATION: Explicitly allow your Vercel URL
const allowedOrigin = "https://pluse-connect.vercel.app";

app.use(cors({
    origin: allowedOrigin,
    methods: ["GET", "POST"],
    credentials: true
}));

app.use(express.json());

// 2. DATABASE CONNECTION (Neon Postgres)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ Database connection failed:', err.message);
    }
    console.log('✅ Connected to Neon Database');
    release();
});

// 3. HEALTH CHECK ROUTE (To wake up Render faster)
app.get('/', (req, res) => {
    res.send('Backend is Awake and Running! ❤️');
});

const server = http.createServer(app);

// 4. SOCKET.IO CONFIGURATION
const io = new Server(server, {
    cors: {
        origin: allowedOrigin,
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// --- API ROUTES ---

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

app.post('/api/login', async (req, res) => {
    const { roomCode, myName } = req.body;
    try {
        const result = await pool.query('SELECT * FROM couples WHERE room_code = $1', [roomCode.toUpperCase()]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Room code not found." });
        }

        const couple = result.rows[0];
        let letter = "";

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
    console.log('User connected:', socket.id);

    socket.on('join-room', (room) => {
        socket.join(room);
        console.log(`User joined room: ${room}`);

        const clients = io.sockets.adapter.rooms.get(room);
        const numClients = clients ? clients.size : 0;

        if (numClients >= 2) {
            io.to(room).emit('update-ui', { isPartnerPresent: true });
        }
    });

    socket.on('send-pulse', async ({ roomId, x, y }) => {
        socket.to(roomId).emit('receive-pulse', { x, y });

        try {
            const result = await pool.query(
                'UPDATE couples SET pulse_count = pulse_count + 1 WHERE room_code = $1 RETURNING pulse_count',
                [roomId.toUpperCase()]
            );

            if (result.rows.length > 0) {
                io.to(roomId).emit('update-count', result.rows[0].pulse_count);
            }
        } catch (err) {
            console.error("Database Pulse Error:", err);
        }
    });

    socket.on('send-gift', ({ roomId, emoji }) => {
        io.to(roomId).emit('receive-gift', { emoji });
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

// Render provides the PORT automatically
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`🚀 ValentConnect Backend Active on Port ${PORT}`);
});
