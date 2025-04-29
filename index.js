import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// PostgreSQL DB setup
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'trichat',
  password: '490923Ma51.',
  port: 5432,
});

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'mysecretkey',
  resave: false,
  saveUninitialized: false,
}));

// ✅ Protect / and /index.html manually
app.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/signup.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/signup.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ✅ Serve static files, but AFTER auth logic
app.use((req, res, next) => {
  if (req.url === '/index.html') {
    // Do nothing, already handled
    return;
  }
  express.static(path.join(__dirname, 'public'))(req, res, next);
});

// POST /signup route
app.post('/signup', async (req, res) => {
  const { name, number, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      'INSERT INTO users(name, number, email, password) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, number, email, hashedPassword]
    );
    req.session.user = result.rows[0];
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Signup failed');
  }
});

// POST /login route
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    console.log("🟡 Incoming email:", email);
    console.log("🟡 Incoming password:", password);
  
    try {
      const query = 'SELECT * FROM users WHERE LOWER(email) = LOWER($1)';
      console.log("🔵 Running query:", query, "with", email);
  
      const result = await pool.query(query, [email]);
      console.log("🟢 Query result rows:", result.rows);
  
      if (result.rows.length === 0) {
        return res.status(401).send('Invalid email or password (user not found)');
      }
  
      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password);
  
      if (!match) {
        return res.status(401).send('Invalid email or password (password mismatch)');
      }
  
      req.session.user = user;
      res.redirect('/');
      
    } catch (err) {
      console.error('🔴 Login error:', err);
      res.status(500).send('Internal server error');
    }
  });
    
  

// 🔓 Logout Route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).send('Logout failed');
      }
      res.redirect('/login.html'); // Redirect to signup or login page
    });
  });
  

// Users Route

app.get('/users', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Not logged in' });
    }
  
    try {
      const result = await pool.query('SELECT * FROM users WHERE id != $1', [req.session.user.id]);
      res.json(result.rows);  // Send list of users excluding the logged-in user
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error fetching users' });
    }
  });  

// Socket.io
io.on('connection', (socket) => {
  console.log('User connected');

  socket.on('chat message', (msg) => {
    io.emit('chat message', msg);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
