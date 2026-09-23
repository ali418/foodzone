const express = require('express');
const router = express.Router();
const authRoutes = require('./auth.routes');
const productRoutes = require('./product.routes');
const categoryRoutes = require('./category.routes');
const inventoryRoutes = require('./inventory.routes');
const salesRoutes = require('./sales.routes');
const customerRoutes = require('./customer.routes');
const customersRoutes = require('./customers.route');
const reportRoutes = require('./report.routes');
const userRoutes = require('./user.routes');
const uploadRoutes = require('./upload.routes');
const notificationRoutes = require('./notification.routes');
const backupRoutes = require('./backup.routes');
const orderRoutes = require('./order.routes');
const mockAuth = require('../middleware/mockAuth');

// Health check route
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'API is running' });
});

// DB Debug endpoint - shows live connection status and env vars
router.get('/db-debug', async (req, res) => {
  const db = require('../models');
  const dns = require('dns').promises;
  const mask = (url) => url ? url.replace(/:([^:@]{4,})@/, ':***@') : 'NOT SET';
  const dbPublicUrl = process.env.DATABASE_PUBLIC_URL;
  const dbUrl       = process.env.DATABASE_URL;
  const chosenUrl   = dbPublicUrl || dbUrl;
  
  // Test DNS lookup for common Railway internal hostnames
  const dnsHosts = [
    'postgres.railway.internal',
    'cafesundusdb.railway.internal',
    'cafesundus-db.railway.internal',
    'fadul-descendants-db.railway.internal',
    'faduldescendantsdb.railway.internal'
  ];
  const dnsResults = {};
  for (const host of dnsHosts) {
    try {
      const lookupResult = await dns.lookup(host);
      dnsResults[host] = lookupResult.address;
    } catch (err) {
      dnsResults[host] = `Error: ${err.code || err.message}`;
    }
  }

  const result = {
    timestamp: new Date().toISOString(),
    env: {
      NODE_ENV:             process.env.NODE_ENV,
      DATABASE_PUBLIC_URL:  mask(dbPublicUrl),
      DATABASE_URL:         mask(dbUrl),
      PGHOST:               process.env.PGHOST || 'NOT SET',
      PGPASSWORD:           process.env.PGPASSWORD ? 'SET' : 'NOT SET',
    },
    dnsLookups:  dnsResults,
    activeUrl:   mask(chosenUrl),
    isInternal:  chosenUrl ? chosenUrl.includes('railway.internal') : null,
    connection:  null,
    error:       null
  };
  try {
    await db.sequelize.authenticate();
    result.connection = 'SUCCESS ✅';
    const [rows] = await db.sequelize.query('SELECT current_database() AS db, current_user AS usr, version() AS ver');
    result.dbInfo = rows[0];
  } catch (err) {
    result.connection = 'FAILED ❌';
    result.error = {
      message: err.message,
      code:    err.original?.code,
      errno:   err.original?.errno,
      type:    err.name
    };
  }
  res.json(result);
});

// Attach mock auth to set a default user (development only)
if (process.env.NODE_ENV === 'development') {
  console.log('Using mock authentication for development');
  router.use(mockAuth);
}

// API routes
router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/sales', salesRoutes);
router.use('/customers', customerRoutes);
router.use('/customers/api', customersRoutes);
router.use('/reports', reportRoutes);
router.use('/users', userRoutes);
router.use('/uploads', uploadRoutes);
const settingsRoutes = require('./setting.routes');
router.use('/settings', settingsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/backups', backupRoutes);
router.use('/orders', orderRoutes);

// 404 route
router.use('*', (req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

module.exports = router;