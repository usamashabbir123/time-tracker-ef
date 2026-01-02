const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth.routes');
const projectsRoutes = require('./routes/projects.routes');
const usersRoutes = require('./routes/users.routes');
const tasksRoutes = require('./routes/tasks.routes');
const timeRoutes = require('./routes/time.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const customersRoutes = require('./routes/customers.routes');
const uploadRoutes = require('./routes/upload.routes');
const historyRoutes = require('./routes/history.routes');
const db = require('./config/db'); // your database config
require('dotenv').config();



const app = express();
const PORT = process.env.PORT || 3000;

// ✅ Middleware
app.use(cors({ 
  origin: [
    'http://localhost:4200',           // Local dev
    'http://localhost',                // Direct localhost
    'http://host.docker.internal:4200', // Docker dev
    'http://host.docker.internal',      // Docker direct
    /localhost/,                       // Any localhost variant
    /host\.docker\.internal/           // Any host.docker.internal variant
  ]
})); // allow Angular frontend
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve uploaded files

// 🔹 Register routes with error handling
try {
  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectsRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/tasks', tasksRoutes);
  app.use('/api/time-entries', timeRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/customers', customersRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/history', historyRoutes);
  
  console.log('✅ Routes registered successfully:');
  console.log('  POST /api/users - Create user');
  console.log('  GET /api/users - Get all users');
  console.log('  PUT /api/users/:id/role - Update user role');
  console.log('  DELETE /api/users/:id - Delete user');
} catch (error) {
  console.error('❌ Error registering routes:', error);
  process.exit(1);
}

// 🔹 Test routes
app.get('/', (req, res) => {
  res.send('Backend is running');
});

// Test route to verify server is working
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working', timestamp: new Date().toISOString() });
});

// 404 handler for debugging (must be last)
app.use((req, res, next) => {
  console.log(`❌ 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: `Route not found: ${req.method} ${req.url}`, availableRoutes: ['/api/users', '/api/projects', '/api/tasks'] });
});

// 🔹 Test database connection
db.getConnection()
  .then(conn => {
    console.log('✅ Database connected successfully');
    conn.release(); // return connection to pool
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

// 🔹 Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
