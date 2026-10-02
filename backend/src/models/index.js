const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);
const env = process.env.NODE_ENV || 'development';

// ─── Database Connection ─────────────────────────────────────────────────────
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

// ── Parse URL into individual components (more reliable than Sequelize URL parsing)
const parseDbUrl = (url) => {
  try {
    const u = new URL(url);
    return {
      host:     u.hostname,
      port:     parseInt(u.port, 10) || 5432,
      database: u.pathname.replace(/^\//, ''),
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  } catch (e) {
    console.error('[DB] Failed to parse URL:', e.message);
    return null;
  }
};

const url1 = process.env.DATABASE_PUBLIC_URL;
const url2 = process.env.DATABASE_URL;

// Identify internal vs public configurations (handling any user swapping)
let internalConfig = null;
let publicConfig = null;

[url1, url2].forEach(url => {
  if (!url) return;
  const parsed = parseDbUrl(url);
  if (!parsed) return;
  const isInt = parsed.host.includes('railway.internal') || parsed.host.includes('localhost') || parsed.host.includes('127.0.0.1');
  if (isInt) {
    internalConfig = parsed;
  } else {
    publicConfig = parsed;
  }
});

const activeConfig = internalConfig || publicConfig;
const initialIsInternal = activeConfig === internalConfig;

console.log(`[DB] Initial config chosen: ${activeConfig ? `${activeConfig.host}:${activeConfig.port}/${activeConfig.database}` : 'NONE'}`);
if (internalConfig) console.log(`[DB] Detected Internal Config Host: ${internalConfig.host}`);
if (publicConfig) console.log(`[DB] Detected Public Config Host: ${publicConfig.host}`);

let sequelize;

if (activeConfig) {
  sequelize = new Sequelize(activeConfig.database, activeConfig.username, activeConfig.password, {
    host:    activeConfig.host,
    port:    activeConfig.port,
    dialect: 'postgres',
    dialectOptions: initialIsInternal
      ? {}
      : { ssl: { rejectUnauthorized: false } },
    logging: false,
    pool:    { max: 3, min: 0, acquire: 30000, idle: 10000 }
  });

  // Enable dynamic DNS fallback if both configs are available
  if (internalConfig && publicConfig) {
    const dns = require('dns').promises;
    let fallbackTriggered = false;

    sequelize.addHook('beforeConnect', async (config) => {
      if (fallbackTriggered) {
        config.host = publicConfig.host;
        config.port = publicConfig.port;
        config.username = publicConfig.username;
        config.password = publicConfig.password;
        config.database = publicConfig.database;
        config.dialectOptions = { ssl: { rejectUnauthorized: false } };
        return;
      }

      if (config.host.includes('railway.internal')) {
        try {
          await dns.lookup(config.host);
        } catch (dnsErr) {
          console.warn(`[DB HOOK] DNS lookup failed for internal host ${config.host}: ${dnsErr.message}. Falling back to public URL: ${publicConfig.host}`);
          fallbackTriggered = true;
          config.host = publicConfig.host;
          config.port = publicConfig.port;
          config.username = publicConfig.username;
          config.password = publicConfig.password;
          config.database = publicConfig.database;
          config.dialectOptions = { ssl: { rejectUnauthorized: false } };
        }
      }
    });
  }

  console.log(`[DB] Connected via ${initialIsInternal ? 'INTERNAL' : 'PUBLIC SSL'} (fallback hook active: ${!!(internalConfig && publicConfig)})`);

} else if (process.env.PGHOST) {
  const pgIsInternal = process.env.PGHOST.includes('railway.internal');
  sequelize = new Sequelize(
    process.env.PGDATABASE,
    process.env.PGUSER,
    process.env.PGPASSWORD,
    {
      host:    process.env.PGHOST,
      port:    parseInt(process.env.PGPORT, 10) || 5432,
      dialect: 'postgres',
      dialectOptions: pgIsInternal ? {} : { ssl: { rejectUnauthorized: false } },
      logging: false,
      pool:    { max: 3, min: 0, acquire: 30000, idle: 10000 }
    }
  );
  console.log(`[DB] Using PG* vars → ${process.env.PGHOST}`);

} else {
  sequelize = new Sequelize(
    process.env.DB_NAME     || 'cafe_sundus',
    process.env.DB_USER     || 'postgres',
    process.env.DB_PASSWORD || 'postgres',
    {
      host:    process.env.DB_HOST || 'localhost',
      port:    parseInt(process.env.DB_PORT, 10) || 5432,
      dialect: 'postgres',
      logging: false,
      pool:    { max: 5, min: 0, acquire: 30000, idle: 10000 }
    }
  );
  console.log('[DB] Using local DB_* vars');
}


const db = {};

// Load models
fs.readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js'
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

// Ensure all models are loaded
const modelFiles = [
  'user.js',
  'product.js',
  'category.js',
  'inventory.js',
  'inventoryTransaction.js',
  'sale.js',
  'saleItem.js',
  'customer.js',
  'notification.js',
  'setting.js'
];

// Check if all required models are loaded
modelFiles.forEach(file => {
  const modelName = path.basename(file, '.js');
  // Convert to PascalCase for model name
  const pascalCaseModelName = modelName.charAt(0).toUpperCase() + modelName.slice(1);
  
  if (!db[pascalCaseModelName]) {
    console.warn(`Warning: Model ${pascalCaseModelName} not loaded. Check if the file exists and is properly defined.`);
  }
});

// Associate models
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

// Sync database models (create tables if they don't exist)
// In production on Railway, we use alter: true to ensure schema matches models
// First, fix any NULL timestamps that might prevent the ALTER from succeeding
const syncDatabase = async () => {
  try {
    console.log('🔄 Preparing database for synchronization...');
    
    // Check if users table exists first
    const [tableExists] = await sequelize.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users');"
    );

    if (tableExists[0].exists) {
      const [results] = await sequelize.query('SELECT COUNT(*) as count FROM "users" WHERE "created_at" IS NULL;');
      const count = parseInt(results[0].count, 10);
      console.log(`🔍 [DB FIX] Found ${count} users with NULL created_at.`);
      
      if (count > 0) {
        console.log('🛠️  [DB FIX] Updating NULL timestamps for users...');
        const [updateResult] = await sequelize.query('UPDATE "users" SET "created_at" = NOW(), "updated_at" = NOW() WHERE "created_at" IS NULL;');
        console.log(`✅ [DB FIX] Update query executed.`);
      }
    }

    // Check if settings table exists
    const [settingsExists] = await sequelize.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'settings');"
    );

    if (settingsExists[0].exists) {
      const [results] = await sequelize.query('SELECT COUNT(*) as count FROM "settings" WHERE "created_at" IS NULL;');
      const count = parseInt(results[0].count, 10);
      console.log(`🔍 [DB FIX] Found ${count} settings with NULL created_at.`);
      
      if (count > 0) {
        console.log('🛠️  [DB FIX] Updating NULL timestamps for settings...');
        await sequelize.query('UPDATE "settings" SET "created_at" = NOW(), "updated_at" = NOW() WHERE "created_at" IS NULL;');
        console.log(`✅ [DB FIX] Settings timestamps updated.`);
      }
    }

    console.log('🔄 Synchronizing models with alter: true...');
    await sequelize.sync({ 
      force: false, 
      alter: true,
      logging: false // Disable SQL logging during sync to avoid flooding console
    });
    console.log('✅ Database synchronized.');
    
    // Get setting model via its name in db object
    const Setting = db.Setting;
    if (Setting) {
      const [setting, created] = await Setting.findOrCreate({
        where: { id: 1 },
        defaults: {
          store_name: 'FOOD Zone Restaurant & Cafe',
          currency_code: 'UGX',
          currency_symbol: 'UGX',
          language: 'ar',
          tax_rate: 15,
          invoice_prefix: 'INV',
          invoice_next_number: 1001
        }
      });

      if (created) {
        console.log('🎉 Default settings created.');
      } else {
        console.log('ℹ️  Default settings already exist.');
      }
    }

    // ── Ensure admin user exists with known password ──
    const User = db.User;
    if (User) {
      const bcrypt = require('bcryptjs');
      const { v4: uuidv4 } = require('uuid');
      const adminUser = await User.findOne({ where: { username: 'admin' } });
      if (!adminUser) {
        const hashed = await bcrypt.hash('admin123', 12);
        await User.create({
          id: uuidv4(),
          username: 'admin',
          email: 'admin@foodzone.space',
          password: hashed,
          fullName: 'System Administrator',
          role: 'admin',
          isActive: true,
        });
        console.log('🎉 Admin user created (username: admin, password: admin123)');
      } else {
        // Reset password to known value if needed
        const hashed = await bcrypt.hash('admin123', 12);
        await adminUser.update({ password: hashed, isActive: true });
        console.log('🔑 Admin password reset to: admin123');
      }
    }
  } catch (err) {
    console.error('❌ Sync failed:', err);
  }
};

db.syncDatabase = syncDatabase;
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;