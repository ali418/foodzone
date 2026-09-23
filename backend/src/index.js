require('dotenv').config();
const crypto = require('crypto');

// 🔐 JWT SECURITY ENFORCEMENT (TOP LEVEL)
// Ensure secrets are present to avoid runtime errors
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim() === '') {
  console.warn('⚠️ [JWT CHECK] JWT_SECRET is missing or empty in environment!');
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.log('🛡️ [JWT CHECK] Generated a new JWT session secret.');
} else {
  console.log(`✅ [JWT CHECK] JWT_SECRET detected (Length: ${process.env.JWT_SECRET.length})`);
}

if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.trim() === '') {
  console.warn('⚠️ [JWT CHECK] JWT_REFRESH_SECRET is missing or empty in environment!');
  process.env.JWT_REFRESH_SECRET = crypto.randomBytes(32).toString('hex');
  console.log('🛡️ [JWT CHECK] Generated a new JWT refresh session secret.');
} else {
  console.log(`✅ [JWT CHECK] JWT_REFRESH_SECRET detected (Length: ${process.env.JWT_REFRESH_SECRET.length})`);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fileUpload = require('express-fileupload');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const db = require('./models');

const app = express();

// Basic Middleware
app.use(helmet({
  contentSecurityPolicy: false // Disable CSP for easier troubleshooting
}));
app.use(cors());

// File upload middleware (MUST be before body parsers for multipart/form-data)
app.use(fileUpload({
  createParentPath: true,
  limits: { 
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  },
  abortOnLimit: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Railway health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/v1', routes);

// Serve Static Uploads (MUST come before frontend catch-all)
const uploadsPath = path.join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(uploadsPath));

// Serve Frontend
const frontendBuildPath = path.join(__dirname, '..', '..', 'frontend', 'build');
app.use(express.static(frontendBuildPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});

// Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

// Start Server
const start = async () => {
  // Listen immediately to satisfy Railway healthcheck
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server started on 0.0.0.0:${PORT}`);
    
    // Connect to database in background
    (async () => {
      try {
        console.log('⏳ Connecting to database...');
        await db.sequelize.authenticate();
        console.log('✅ Database connected successfully');
        
        // Now, sync the database
        if (db && db.syncDatabase) {
          await db.syncDatabase(); // AWAIT THE SYNC
        } else {
          console.error('❌ syncDatabase function not found in db object');
        }

      } catch (error) {
        console.error('❌ Database connection failed:', error.message);
      }
    })();
  });
};

start();
