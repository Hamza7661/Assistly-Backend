const PackageSeeder = require('./packageSeeder');
const { logger } = require('../src/utils/logger');
const mongoose = require('mongoose');
require('dotenv').config();

class MainSeeder {
  static async connectDB() {
    try {
      const mongoURI = process.env.MONGODB_URI;
      await mongoose.connect(mongoURI);
      logger.info('✅ Connected to MongoDB successfully');
    } catch (error) {
      logger.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }

  static async disconnectDB() {
    try {
      await mongoose.disconnect();
      logger.info('✅ Disconnected from MongoDB');
    } catch (error) {
      logger.error('❌ MongoDB disconnection failed:', error);
    }
  }

  static async seedAll() {
    try {
      logger.info('🚀 Starting main seeder...');
      
      // Connect to database
      await this.connectDB();
      
      // Seed packages first
      logger.info('📦 Seeding packages...');
      await PackageSeeder.seed();
      
      // Add more seeders here as they are created
      // await UserSeeder.seed();
      // await RoleSeeder.seed();
      // await PermissionSeeder.seed();
      
      logger.info('✅ All seeders completed successfully!');
      
      // Disconnect from database
      await this.disconnectDB();
      
    } catch (error) {
      logger.error('❌ Error in main seeder:', error);
      await this.disconnectDB();
      throw error;
    }
  }

  static async clearAll() {
    try {
      logger.info('🧹 Starting main clear...');
      
      // Connect to database
      await this.connectDB();
      
      // Clear packages
      logger.info('📦 Clearing packages...');
      await PackageSeeder.clear();
      
      // Add more clear methods here as they are created
      // await UserSeeder.clear();
      // await RoleSeeder.clear();
      // await PermissionSeeder.clear();
      
      logger.info('✅ All data cleared successfully!');
      
      // Disconnect from database
      await this.disconnectDB();
      
    } catch (error) {
      logger.error('❌ Error in main clear:', error);
      await this.disconnectDB();
      throw error;
    }
  }

  static async resetAll() {
    try {
      logger.info('🔄 Starting main reset...');
      
      // Connect to database
      await this.connectDB();
      
      // Reset packages
      logger.info('📦 Resetting packages...');
      await PackageSeeder.reset();
      
      // Add more reset methods here as they are created
      // await UserSeeder.reset();
      // await RoleSeeder.reset();
      // await PermissionSeeder.reset();
      
      logger.info('✅ All data reset completed!');
      
      // Disconnect from database
      await this.disconnectDB();
      
    } catch (error) {
      logger.error('❌ Error in main reset:', error);
      await this.disconnectDB();
      throw error;
    }
  }

  static async status() {
    try {
      logger.info('📊 Checking seeder status...');
      
      // Connect to database
      await this.connectDB();
      
      // Check package status
      const { Package } = require('../src/models/Package');
      const packageCount = await Package.countDocuments();
      logger.info(`📦 Packages: ${packageCount} found`);
      
      // Add more status checks here as they are created
      // const userCount = await User.countDocuments();
      // logger.info(`👥 Users: ${userCount} found`);
      
      logger.info('✅ Status check completed!');
      
      // Disconnect from database
      await this.disconnectDB();
      
    } catch (error) {
      logger.error('❌ Error checking status:', error);
      await this.disconnectDB();
      throw error;
    }
  }
}

// CLI support
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'seed':
      MainSeeder.seedAll()
        .then(() => {
          logger.info('🎉 Seeding completed!');
          process.exit(0);
        })
        .catch((error) => {
          logger.error('💥 Seeding failed:', error);
          process.exit(1);
        });
      break;
      
    case 'clear':
      MainSeeder.clearAll()
        .then(() => {
          logger.info('🎉 Clearing completed!');
          process.exit(0);
        })
        .catch((error) => {
          logger.error('💥 Clearing failed:', error);
          process.exit(1);
        });
      break;
      
    case 'reset':
      MainSeeder.resetAll()
        .then(() => {
          logger.info('🎉 Reset completed!');
          process.exit(0);
        })
        .catch((error) => {
          logger.error('💥 Reset failed:', error);
          process.exit(1);
        });
      break;
      
    case 'status':
      MainSeeder.status()
        .then(() => {
          logger.info('🎉 Status check completed!');
          process.exit(0);
        })
        .catch((error) => {
          logger.error('💥 Status check failed:', error);
          process.exit(1);
        });
      break;
      
    default:
      logger.info('Usage: node seeders/mainSeeder.js [seed|clear|reset|status]');
      logger.info('  seed   - Seed all data');
      logger.info('  clear  - Clear all data');
      logger.info('  reset  - Reset all data (clear + seed)');
      logger.info('  status - Check current data status');
      process.exit(0);
  }
}

module.exports = MainSeeder;
