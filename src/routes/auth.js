const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { User, userValidationSchema } = require('../models/User');

const router = express.Router();

class AuthController {
  static generateTokens(userId) {
    const accessToken = jwt.sign(
      { 
        userId,
        type: 'access',
        jti: uuidv4()
      },
      process.env.JWT_SECRET,
      { 
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        issuer: process.env.JWT_ISSUER || 'assistly-backend',
        audience: process.env.JWT_AUDIENCE || 'assistly-users'
      }
    );

    const refreshToken = jwt.sign(
      { 
        userId,
        type: 'refresh',
        jti: uuidv4()
      },
      process.env.JWT_SECRET,
      { 
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
        issuer: process.env.JWT_ISSUER || 'assistly-backend',
        audience: process.env.JWT_AUDIENCE || 'assistly-users'
      }
    );

    return { accessToken, refreshToken };
  }

  static async signup(req, res, next) {
    try {
      const { error, value } = userValidationSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true
      });

      if (error) {
        const errorMessages = error.details.map(detail => detail.message);
        throw new AppError(`Validation failed: ${errorMessages.join(', ')}`, 400);
      }

      const { firstName, lastName, phoneNumber, email, professionDescription, industry, region, package: packageId, password, website } = value;

      const existingUserByEmail = await User.findByEmail(email);
      if (existingUserByEmail) {
        throw new AppError('User with this email already exists', 409);
      }

      const existingUserByPhone = await User.findByPhone(phoneNumber);
      if (existingUserByPhone) {
        throw new AppError('User with this phone number already exists', 409);
      }

      const userData = {
        firstName,
        lastName,
        phoneNumber,
        email,
        professionDescription,
        industry,
        region: region || 'uk',
        password,
        website,
        metadata: {
          signupSource: req.headers['x-signup-source'] || 'web',
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip || req.connection.remoteAddress,
          referrer: req.headers.referer
        }
      };

      // Only add package if provided
      if (packageId) {
        userData.package = packageId;
      }

      const user = new User(userData);
      await user.save();

      const { accessToken, refreshToken } = AuthController.generateTokens(user._id);

      user.lastLogin = new Date();
      await user.save();

      logger.info(`New user registered: ${user.email} (${user._id})`);

      // Note: Email verification will be handled by frontend calling /api/v1/email/verify/send
      // This keeps the signup process fast and allows frontend to control email templates

      res.status(201).json({
        status: 'success',
        message: 'User registered successfully. Please check your email for verification.',
        data: {
          user: user.getProfile(),
          tokens: {
            accessToken,
            refreshToken
          },
          requiresEmailVerification: true
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async signin(req, res, next) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        throw new AppError('Email and password are required', 400);
      }

      const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
      
      if (!user) {
        throw new AppError('Account not found. Please sign up to continue.', 401);
      }

      if (!user.isActive) {
        throw new AppError('Account is deactivated. Please contact support.', 401);
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        throw new AppError('Invalid email or password', 401);
      }

      const { accessToken, refreshToken } = AuthController.generateTokens(user._id);

      user.lastLogin = new Date();
      // Skip validation during signin to allow users without industry to sign in
      await user.save({ validateBeforeSave: false });

      logger.info(`User signed in: ${user.email} (${user._id})`);

      res.status(200).json({
        status: 'success',
        message: 'Login successful',
        data: {
          user: user.getProfile(),
          tokens: {
            accessToken,
            refreshToken
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw new AppError('Refresh token is required', 400);
      }

      const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
      
      if (decoded.type !== 'refresh') {
        throw new AppError('Invalid token type', 401);
      }

      const user = await User.findById(decoded.userId);
      if (!user) {
        throw new AppError('User not found', 401);
      }

      if (!user.isActive) {
        throw new AppError('Account is deactivated', 401);
      }

      const { accessToken, refreshToken: newRefreshToken } = AuthController.generateTokens(user._id);

      logger.info(`Token refreshed for user: ${user.email} (${user._id})`);

      res.status(200).json({
        status: 'success',
        message: 'Token refreshed successfully',
        data: {
          tokens: {
            accessToken,
            refreshToken: newRefreshToken
          }
        }
      });

    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        next(new AppError('Invalid refresh token', 401));
      } else if (error.name === 'TokenExpiredError') {
        next(new AppError('Refresh token expired', 401));
      } else {
        next(error);
      }
    }
  }

  static async getProfile(req, res, next) {
    try {
      const user = await User.findById(req.user.userId);
      
      if (!user) {
        throw new AppError('User not found', 401);
      }

      if (!user.isActive) {
        throw new AppError('Account is deactivated', 401);
      }

      res.status(200).json({
        status: 'success',
        data: {
          user: user.getProfile()
        }
      });

    } catch (error) {
      next(error);
    }
  }

  static async logout(req, res, next) {
    try {
      logger.info(`User logged out: ${req.user.userId}`);
      
      res.status(200).json({
        status: 'success',
        message: 'Logged out successfully'
      });

    } catch (error) {
      next(error);
    }
  }
}

router.post('/signup', AuthController.signup);
router.post('/signin', AuthController.signin);
router.post('/refresh-token', AuthController.refreshToken);
router.get('/profile', AuthController.getProfile);
router.post('/logout', AuthController.logout);

module.exports = router;
