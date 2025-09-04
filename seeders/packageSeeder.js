const { Package } = require('../src/models/Package');
const { logger } = require('../src/utils/logger');
const { PACKAGE_TYPES, PACKAGE_CURRENCIES, PACKAGE_BILLING_CYCLES } = require('../src/enums/packageTypes');

const packages = [
  {
    id: 1,
    name: 'Free Trial',
    type: PACKAGE_TYPES.FREE_TRIAL,
    price: {
      amount: 0,
      currency: PACKAGE_CURRENCIES.USD,
      billingCycle: PACKAGE_BILLING_CYCLES.MONTHLY
    },
    limits: {
      chatbotQueries: 50,
      voiceMinutes: 60
    },
    features: {
      chatbot: true,
      voiceAgent: true
    },
    description: '50 AI chatbot queries per month. 60 voice minutes per month. Basic chatbot functionality. Voice agent access. No credit card required.',
    isActive: true,
    isPopular: false,
    sortOrder: 1
  },
  {
    id: 2,
    name: 'Basic',
    type: PACKAGE_TYPES.BASIC,
    price: {
      amount: 20,
      currency: PACKAGE_CURRENCIES.USD,
      billingCycle: PACKAGE_BILLING_CYCLES.MONTHLY
    },
    limits: {
      chatbotQueries: 500,
      voiceMinutes: 300
    },
    features: {
      chatbot: true,
      voiceAgent: true
    },
    description: '500 AI chatbot queries per month. 300 voice minutes per month. Advanced chatbot functionality. Voice agent access. Analytics dashboard.',
    isActive: true,
    isPopular: true,
    sortOrder: 2
  },
  {
    id: 3,
    name: 'Pro',
    type: PACKAGE_TYPES.PRO,
    price: {
      amount: 50,
      currency: PACKAGE_CURRENCIES.USD,
      billingCycle: PACKAGE_BILLING_CYCLES.MONTHLY
    },
    limits: {
      chatbotQueries: 2000,
      voiceMinutes: 1000
    },
    features: {
      chatbot: true,
      voiceAgent: true
    },
    description: '2000 AI chatbot queries per month. 1000 voice minutes per month. Advanced chatbot functionality. Voice agent access. Priority support.',
    isActive: true,
    isPopular: true,
    sortOrder: 3
  },
  {
    id: 4,
    name: 'Premium',
    type: PACKAGE_TYPES.PREMIUM,
    price: {
      amount: 100,
      currency: PACKAGE_CURRENCIES.USD,
      billingCycle: PACKAGE_BILLING_CYCLES.MONTHLY
    },
    limits: {
      chatbotQueries: -1, // Unlimited
      voiceMinutes: -1,   // Unlimited
      leadGeneration: -1  // Unlimited
    },
    features: {
      chatbot: true,
      voiceAgent: true,
      leadGeneration: true
    },
    description: 'Unlimited AI chatbot queries per month. Unlimited voice minutes per month. Unlimited lead generation contacts per month. Advanced chatbot functionality. Voice agent access.',
    isActive: true,
    isPopular: false,
    sortOrder: 4
  }
];

class PackageSeeder {
  static async seed() {
    try {
      logger.info('Starting package seeding...');
      
      // Check if packages already exist
      const existingPackages = await Package.countDocuments();
      if (existingPackages > 0) {
        logger.info('Packages already exist, skipping seeding');
        return;
      }

      // Insert packages
      const result = await Package.insertMany(packages);
      logger.info(`✅ Successfully seeded ${result.length} packages`);
      
      // Log seeded packages
      result.forEach(pkg => {
        logger.info(`📦 Package ${pkg.id}: ${pkg.name} - ${pkg.price.currency} ${pkg.price.amount}/${pkg.price.billingCycle}`);
      });

    } catch (error) {
      logger.error('❌ Error seeding packages:', error);
      throw error;
    }
  }

  static async clear() {
    try {
      logger.info('Clearing all packages...');
      await Package.deleteMany({});
      logger.info('✅ All packages cleared');
    } catch (error) {
      logger.error('❌ Error clearing packages:', error);
      throw error;
    }
  }

  static async reset() {
    try {
      logger.info('Resetting packages...');
      await this.clear();
      await this.seed();
      logger.info('✅ Packages reset completed');
    } catch (error) {
      logger.error('❌ Error resetting packages:', error);
      throw error;
    }
  }
}

module.exports = PackageSeeder;
