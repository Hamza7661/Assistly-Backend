const express = require('express');
const { logger } = require('../utils/logger');
const { AppError } = require('../utils/errorHandler');
const { Package, customPackageValidationSchema } = require('../models/Package');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

class PackageController {
  // Get all active packages (excluding custom packages)
  static async getAllPackages(req, res, next) {
    try {
      const packages = await Package.find({ isActive: true, isCustom: { $ne: true } }).sort({ sortOrder: 1, id: 1 });
      
      logger.info(`Retrieved ${packages.length} active normal packages`);
      
      res.status(200).json({
        status: 'success',
        count: packages.length,
        data: {
          packages: packages
        }
      });
      
    } catch (error) {
      next(error);
    }
  }

  // Get package by ID
  static async getPackageById(req, res, next) {
    try {
      const { id } = req.params;
      
      if (!id || isNaN(parseInt(id))) {
        throw new AppError('Invalid package ID', 400);
      }
      
      const packageData = await Package.getById(parseInt(id));
      
      if (!packageData) {
        throw new AppError('Package not found', 404);
      }
      
      logger.info(`Retrieved package: ${packageData.name} (ID: ${packageData.id})`);
      
      res.status(200).json({
        status: 'success',
        data: {
          package: packageData
        }
      });
      
    } catch (error) {
      next(error);
    }
  }

  // Get package by type
  static async getPackageByType(req, res, next) {
    try {
      const { type } = req.params;
      
      if (!type) {
        throw new AppError('Package type is required', 400);
      }
      
      const packageData = await Package.getByType(type);
      
      if (!packageData) {
        throw new AppError('Package not found', 404);
      }
      
      logger.info(`Retrieved package by type: ${packageData.name} (${type})`);
      
      res.status(200).json({
        status: 'success',
        data: {
          package: packageData
        }
      });
      
    } catch (error) {
      next(error);
    }
  }

  // Get popular packages (excluding custom packages)
  static async getPopularPackages(req, res, next) {
    try {
      const packages = await Package.find({ isPopular: true, isActive: true, isCustom: { $ne: true } }).sort({ sortOrder: 1, id: 1 });
      
      logger.info(`Retrieved ${packages.length} popular normal packages`);
      
      res.status(200).json({
        status: 'success',
        count: packages.length,
        data: {
          packages: packages
        }
      });
      
    } catch (error) {
      next(error);
    }
  }

  // Get packages with filtering and pagination
  static async getPackagesWithFilters(req, res, next) {
    try {
      const { 
        type, 
        minPrice, 
        maxPrice, 
        hasFeature, 
        limit = 10, 
        page = 1,
        sortBy = 'sortOrder',
        sortOrder = 'asc'
      } = req.query;

      // Build filter object (exclude custom packages by default)
      const filter = { isActive: true, isCustom: { $ne: true } };
      
      if (type) {
        filter.type = type;
      }
      
      if (minPrice !== undefined || maxPrice !== undefined) {
        filter['price.amount'] = {};
        if (minPrice !== undefined) filter['price.amount'].$gte = parseFloat(minPrice);
        if (maxPrice !== undefined) filter['price.amount'].$lte = parseFloat(maxPrice);
      }
      
      if (hasFeature) {
        filter[`features.${hasFeature}`] = true;
      }

      // Build sort object
      const sort = {};
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

      // Calculate pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      // Execute query
      const packages = await Package.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit));
      
      // Get total count for pagination
      const total = await Package.countDocuments(filter);
      
      logger.info(`Retrieved ${packages.length} packages with filters (page ${page}, limit ${limit})`);
      
      res.status(200).json({
        status: 'success',
        count: packages.length,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          hasNextPage: skip + packages.length < total,
          hasPrevPage: parseInt(page) > 1
        },
        data: {
          packages: packages
        }
      });
      
    } catch (error) {
      next(error);
    }
  }

  // Compare packages
  static async comparePackages(req, res, next) {
    try {
      const { ids } = req.query;
      
      if (!ids) {
        throw new AppError('Package IDs are required for comparison', 400);
      }
      
      const packageIds = ids.split(',').map(id => parseInt(id.trim()));
      
      if (packageIds.length < 2 || packageIds.length > 5) {
        throw new AppError('Please provide 2-5 package IDs for comparison', 400);
      }
      
      const packages = await Package.find({ 
        id: { $in: packageIds }, 
        isActive: true 
      }).sort({ id: 1 });
      
      if (packages.length !== packageIds.length) {
        throw new AppError('Some packages not found', 404);
      }
      
      logger.info(`Comparing ${packages.length} packages: ${packages.map(p => p.name).join(', ')}`);
      
      res.status(200).json({
        status: 'success',
        count: packages.length,
        data: {
          packages: packages,
          comparison: {
            priceRange: {
              min: Math.min(...packages.map(p => p.price.amount)),
              max: Math.max(...packages.map(p => p.price.amount))
            },
            features: {
              chatbot: packages.every(p => p.features.chatbot),
              voiceAgent: packages.every(p => p.features.voiceAgent),
              analytics: packages.every(p => p.features.analytics),
              apiAccess: packages.every(p => p.features.apiAccess),
              prioritySupport: packages.every(p => p.features.prioritySupport),
              customIntegration: packages.every(p => p.features.customIntegration),
              whiteLabel: packages.every(p => p.features.whiteLabel)
            }
          }
        }
      });
      
    } catch (error) {
      next(error);
    }
  }

  // Get custom packages
  static async getCustomPackages(req, res, next) {
    try {
      const customPackages = await Package.find({ isCustom: true, isActive: true }).sort({ id: 1 });
      
      logger.info(`Retrieved ${customPackages.length} custom packages`);
      
      res.status(200).json({
        status: 'success',
        count: customPackages.length,
        data: {
          packages: customPackages
        }
      });
      
    } catch (error) {
      next(error);
    }
  }

  // Create custom package
  static async createCustomPackage(req, res, next) {
    try {
      logger.info('Creating custom package with data:', req.body);
      
      const { error, value } = customPackageValidationSchema.validate(req.body, {
        abortEarly: false,
        allowUnknown: true
      });

      if (error) {
        const errorMessages = error.details.map(detail => detail.message);
        throw new AppError(`Validation failed: ${errorMessages.join(', ')}`, 400);
      }

      // Ensure custom packages have isCustom: true
      value.isCustom = true;
      
      // Generate next available ID for custom packages
      const lastPackage = await Package.findOne().sort({ id: -1 });
      const nextId = lastPackage ? lastPackage.id + 1 : 1;
      value.id = nextId;
      
      // Generate name for custom package
      value.name = `Custom Package ${nextId}`;
      
      // Set default description if none provided
      if (!value.description) {
        value.description = `Custom package with ${value.price.currency} ${value.price.amount}/${value.price.billingCycle} pricing`;
      }

      const customPackage = new Package(value);
      await customPackage.save();

      logger.info(`Created custom package: ${customPackage.name} (ID: ${customPackage.id})`);

      res.status(201).json({
        status: 'success',
        message: 'Custom package created successfully',
        data: {
          package: customPackage
        }
      });

    } catch (error) {
      next(error);
    }
  }
}

// Routes
router.get('/', authenticateToken, PackageController.getAllPackages);
router.get('/filter', authenticateToken, PackageController.getPackagesWithFilters);
router.get('/popular', PackageController.getPopularPackages);
router.get('/compare', PackageController.comparePackages);
router.get('/type/:type', PackageController.getPackageByType);
router.get('/:id', PackageController.getPackageById);
router.get('/custom', PackageController.getCustomPackages);
router.post('/custom', authenticateToken, PackageController.createCustomPackage);

module.exports = router;
