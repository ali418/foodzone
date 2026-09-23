const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, LoginHistory } = require('../models');

/**
 * Register a new user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.register = async (req, res, next) => {
  try {
    const { username, email, password, fullName, role = 'user' } = req.body;

    // تنظيف اسم المستخدم والبريد الإلكتروني من المسافات الزائدة
    const cleanUsername = username.trim();
    const cleanEmail = email.trim();

    // Check if user already exists
    const existingUser = await User.findOne({ where: { email: cleanEmail } });
    if (existingUser) {
      const error = new Error('User with this email already exists');
      error.statusCode = 409;
      throw error;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create new user
    const user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      password: hashedPassword,
      fullName,
      role,
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Generate refresh token
    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    // Return user data and tokens
    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.login = async (req, res, next) => {
  console.log('[LOGIN ATTEMPT] Received request');
  try {
    const { username, password } = req.body;
    console.log(`[LOGIN ATTEMPT] User: ${username}`);

    if (!username || !password) {
      console.log('[LOGIN ERROR] Username or password missing');
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const cleanUsername = username.trim();
    console.log(`[LOGIN PROCESS] Searching for user: ${cleanUsername}`);

    const { Op } = require('sequelize');
    const user = await User.findOne({ 
      where: { 
        username: {
          [Op.iLike]: cleanUsername 
        }
      } 
    });

    if (!user) {
      console.log(`[LOGIN FAILED] User not found: ${cleanUsername}`);
      const error = new Error('Invalid credentials');
      error.statusCode = 401;
      return next(error);
    }
    console.log(`[LOGIN PROCESS] User found: ${user.username} (ID: ${user.id})`);

    console.log('[LOGIN PROCESS] Comparing password...');
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      console.log(`[LOGIN FAILED] Invalid password for user: ${user.username}`);
      const error = new Error('Invalid credentials');
      error.statusCode = 401;
      return next(error);
    }
    console.log('[LOGIN PROCESS] Password is valid');

    console.log(`[LOGIN PROCESS] JWT_SECRET length: ${process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 'Not Found'}`);
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
    console.log('[LOGIN PROCESS] JWT token generated');

    console.log(`[LOGIN PROCESS] JWT_REFRESH_SECRET length: ${process.env.JWT_REFRESH_SECRET ? process.env.JWT_REFRESH_SECRET.length : 'Not Found'}`);
    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );
    console.log('[LOGIN PROCESS] Refresh token generated');

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      token,
      refreshToken,
    });
    console.log(`[LOGIN SUCCESS] User ${user.username} logged in successfully`);

  } catch (error) {
    console.error('[LOGIN CRITICAL ERROR]', error);
    next(error);
  }
};

/**
 * Refresh JWT token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ message: "No refresh token" });
    }

    // في حالة وجود نموذج TokenModel، يمكن التحقق من وجود التوكن في قاعدة البيانات
    // const storedToken = await TokenModel.findOne({ where: { token: refreshToken } });
    // if (!storedToken) return res.status(401).json({ message: "Invalid refresh token" });

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    // Find user
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    // Generate new JWT token
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Generate new refresh token
    const newRefreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    res.status(200).json({
      message: 'Token refreshed successfully',
      token,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
exports.logout = async (req, res, next) => {
  try {
    // In a real application, you would invalidate the refresh token
    // This could be done by adding it to a blacklist or removing it from the database
    
    res.status(200).json({
      message: 'Logout successful',
    });
  } catch (error) {
    next(error);
  }
};