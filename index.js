import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const upload = multer({ dest: 'public/uploads/' });
const PORT = process.env.PORT || 3000;

// PostgreSQL DB setup
// const pool = new Pool({
//   user: 'postgres',
//   host: 'localhost',
//   database: 'trichat',
//   password: '490923Ma51.',
//   port: 5432,
// });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Use the DATABASE_URL environment variable
  ssl: {
    rejectUnauthorized: false, // Allow for SSL connection (necessary for Railway)
  },
});

// Middlewares
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));
app.use('/images', express.static('public/images'));
app.use(express.json());
app.use(session({
  secret: 'mysecretkey',
  resave: false,
  saveUninitialized: false,
}));

// ✅ Protect / and /index.html manually
app.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login.html');
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
    if (!name || !number || !email || !password) {
      return res.status(400).send('All fields are required');
    }
    const result = await pool.query(
      'INSERT INTO users(name, number, email, password) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, number, email, hashedPassword]
    );
    req.session.user = result.rows[0];
    res.redirect('/');
  } catch (err) {
    console.error('Signup Error:', err); // Log detailed error
    if (err.code === '23505') { // Unique constraint violation (email already exists)
      return res.status(400).send('Email already in use');
    }
    res.status(500).send('Signup failed');
  }
});

// POST /login route
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).send('Email and password are required');
    }
    const query = 'SELECT * FROM users WHERE LOWER(email) = LOWER($1)';
    const result = await pool.query(query, [email]);

    if (result.rows.length === 0) {
      return res.status(401).send('Invalid email or password');
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).send('Invalid email or password');
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar || '/images/default-avatar.jpg',
    };
    res.redirect('/');
  } catch (err) {
    console.error('Login Error:', err); // Log detailed error
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
  
    const search = req.query.search || ''; // from ?search=john
  
    try {
      const result = await pool.query(
        'SELECT * FROM users WHERE id != $1 AND LOWER(name) LIKE $2',
        [req.session.user.id, `%${search.toLowerCase()}%`]
      );
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error fetching users' });
    }
  });

  // Profile Route
  app.get('/profile', (req, res) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
  
    res.render('profile', { user: req.session.user });
  });
  

  // Messages Route
  app.post('/messages', async (req, res) => {
    const { senderId, receiverId, message } = req.body;

    try {
        await pool.query(
            'INSERT INTO chats (sender_id, receiver_id, message) VALUES ($1, $2, $3)',
            [senderId, receiverId, message]
        );
        res.status(201).json({ message: 'Message sent' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error sending message' });
    }
});

// GET /messages/:userId route
app.get('/messages/:userId', async (req, res) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Not logged in' });
    }
  
    const currentUserId = req.session.user.id;
    const otherUserId = req.params.userId;
  
    try {
      const result = await pool.query(`
        SELECT * FROM chats 
        WHERE (sender_id = $1 AND receiver_id = $2) 
           OR (sender_id = $2 AND receiver_id = $1)
        ORDER BY created_at ASC
      `, [currentUserId, otherUserId]);
  
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Error fetching messages' });
    }
  });  

// GET /me route
// This route returns the logged-in user's information
// GET /me route
app.get('/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not logged in' });  // Make sure user session exists
    }
    res.json({ userId: req.session.user.id });  // Send user info back to the frontend
});  

// Settings Route
app.get('/settings', async (req, res) => {
    if (!req.session.user) return res.redirect('/login.html');
  
    const userId = req.session.user.id;
  
    try {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      const user = result.rows[0];
      res.render('settings', { user });
    } catch (err) {
      console.error('Error fetching user settings:', err);
      res.status(500).send('Internal server error');
    }
  });  

// Upload photo
app.post('/profile/photo', upload.single('avatar'), async (req, res) => {
    const filename = req.file.filename;
    const avatarPath = `/uploads/${filename}`;
    const userId = req.session.user.id;

    // Save to DB
    pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [filename, userId]);

    // Update session
    req.session.user.avatar = avatarPath;

    res.redirect('/profile');
});
  
  // Edit profile
  app.post('/profile/edit', async (req, res) => {
    const { name, email } = req.body;
    const userId = req.session.user.id;

    await pool.query('UPDATE users SET name = $1, email = $2 WHERE id = $3', [name, email, userId]);
    // Update session too
    req.session.user.name = name;
    req.session.user.email = email;

    res.redirect('/profile');
});
  
  // Change password
  app.post('/profile/change-password', async (req, res) => {
      const { currentPassword, newPassword, confirmPassword } = req.body;
      const userId = req.session.user.id;
  
      if (newPassword !== confirmPassword) {
          return res.send('Passwords do not match');
      }
  
      const result = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
      const hashedPassword = result.rows[0].password;
  
      const isMatch = await bcrypt.compare(currentPassword, hashedPassword);
      if (!isMatch) {
          return res.send('Incorrect current password');
      }
  
      const newHashedPassword = await bcrypt.hash(newPassword, 10);
      await pool.query('UPDATE users SET password = $1 WHERE id = $2', [newHashedPassword, userId]);
  
      res.send('Password changed successfully');
  });  
  
// 🔌 Socket.io Setup with Debug Logs
io.on('connection', (socket) => {
    console.log('🟢 New user connected:', socket.id);
  
    // Listen for custom 'sendMessage' events from frontend
    socket.on('sendMessage', async (data) => {
      const { senderId, receiverId, message } = data;
      console.log('📨 Message received from client:', data);
  
      try {
        // Save to database
        const result = await pool.query(
          'INSERT INTO chats (sender_id, receiver_id, message) VALUES ($1, $2, $3) RETURNING *',
          [senderId, receiverId, message]
        );
        const savedMessage = result.rows[0];
        console.log('💾 Message saved to DB:', savedMessage);
  
        // Emit to all connected clients (for now)
        io.emit('receiveMessage', savedMessage);
        console.log('📡 Broadcasted message to clients');
  
      } catch (err) {
        console.error('❌ Error handling sendMessage:', err);
      }
    });
  
    socket.on('disconnect', () => {
      console.log('🔴 User disconnected:', socket.id);
    });
  });  

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
