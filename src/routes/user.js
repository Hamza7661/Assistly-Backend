const express = require('express');
const router = express.Router();
const { User } = require('../models/User');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { authenticateToken, requireAdmin, requireUserOrAdmin } = require('../middleware/auth');

class UserController {
  async getCurrentUser(req, res, next) {
    try {
      const userId = req.user.id;
      
      if (!userId) {
        return next(new AppError('User ID not found in token', 401));
      }

      const user = await User.findById(userId)
        .select('-password -refreshToken')
        .populate('package', 'name price limits features type');

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      if (!user.isActive) {
        return next(new AppError('Account is deactivated', 401));
      }

      logger.info('Retrieved current user profile', { userId });

      res.status(200).json({
        status: 'success',
        data: {
          user
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve current user', 500));
    }
  }

  async getAllUsers(req, res, next) {
    try {
      const users = await User.find({}).select('-password -refreshToken');
      
      logger.info('Retrieved all users', { count: users.length });
      
      res.status(200).json({
        status: 'success',
        data: {
          users,
          count: users.length
        }
      });
    } catch (error) {
      next(new AppError('Failed to retrieve users', 500));
    }
  }

  async getUserById(req, res, next) {
    try {
      const { id } = req.params;
      
      if (!id) {
        return next(new AppError('User ID is required', 400));
      }

      const user = await User.findById(id)
        .select('-password -refreshToken')
        .populate('package', 'name price limits features type');

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      logger.info('Retrieved user by ID', { userId: id });

      res.status(200).json({
        status: 'success',
        data: {
          user
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to retrieve user', 500));
    }
  }

  async updateUser(req, res, next) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (!id) {
        return next(new AppError('User ID is required', 400));
      }

      const allowedUpdates = ['firstName', 'lastName', 'phoneNumber', 'email', 'profession', 'professionDescription', 'package', 'website'];
      const filteredUpdates = {};

      Object.keys(updateData).forEach(key => {
        if (!allowedUpdates.includes(key)) return;
        let value = updateData[key];

        // Map alias 'profession' -> 'professionDescription'
        const targetKey = key === 'profession' ? 'professionDescription' : key;

        // Treat empty string website as null (clear)
        if (targetKey === 'website' && (value === '' || value === undefined)) {
          value = null;
        }

        filteredUpdates[targetKey] = value;
      });

      if (Object.keys(filteredUpdates).length === 0) {
        return next(new AppError('No valid fields to update', 400));
      }

      const user = await User.findByIdAndUpdate(
        id,
        filteredUpdates,
        { new: true, runValidators: true }
      ).select('-password -refreshToken');

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      logger.info('Updated user', { userId: id, updatedFields: Object.keys(filteredUpdates) });

      res.status(200).json({
        status: 'success',
        data: {
          user
        }
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      if (error.name === 'ValidationError') {
        return next(new AppError(error.message, 400));
      }
      next(new AppError('Failed to update user', 500));
    }
  }

  async deleteUser(req, res, next) {
    try {
      const { id } = req.params;

      if (!id) {
        return next(new AppError('User ID is required', 400));
      }

      const user = await User.findByIdAndDelete(id);

      if (!user) {
        return next(new AppError('User not found', 404));
      }

      logger.info('Deleted user', { userId: id });

      res.status(200).json({
        status: 'success',
        message: 'User deleted successfully'
      });
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid user ID format', 400));
      }
      next(new AppError('Failed to delete user', 500));
    }
  }
}

const userController = new UserController();

router.get('/me', authenticateToken, userController.getCurrentUser);
router.get('/', authenticateToken, requireAdmin, userController.getAllUsers);
router.get('/:id', authenticateToken, requireUserOrAdmin, userController.getUserById);
router.put('/:id', authenticateToken, requireUserOrAdmin, userController.updateUser);
router.delete('/:id', authenticateToken, requireAdmin, userController.deleteUser);

module.exports = router;
