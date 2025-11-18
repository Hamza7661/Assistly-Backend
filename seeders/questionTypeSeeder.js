const { QuestionType } = require('../src/models/QuestionType');
const { logger } = require('../src/utils/logger');

const questionTypes = [
  {
    id: 1,
    code: 'single_choice',
    value: 'Single Choice',
    isActive: true
  },
  {
    id: 2,
    code: 'multiple_choice',
    value: 'Multiple Choice',
    isActive: true
  },
  {
    id: 3,
    code: 'text_response',
    value: 'Text Response',
    isActive: true
  }
];

class QuestionTypeSeeder {
  static async seed() {
    try {
      logger.info('Starting question type seeding...');
      
      // Check if question types already exist
      const existingCount = await QuestionType.countDocuments();
      if (existingCount > 0) {
        logger.info('Question types already exist, skipping seeding');
        return;
      }

      // Insert question types
      const result = await QuestionType.insertMany(questionTypes);
      logger.info(`✅ Successfully seeded ${result.length} question types`);
      
      // Log seeded question types
      result.forEach(qt => {
        logger.info(`❓ Question Type ${qt.id}: ${qt.code} - ${qt.value}`);
      });

    } catch (error) {
      logger.error('❌ Error seeding question types:', error);
      throw error;
    }
  }

  static async clear() {
    try {
      logger.info('Clearing all question types...');
      await QuestionType.deleteMany({});
      logger.info('✅ All question types cleared');
    } catch (error) {
      logger.error('❌ Error clearing question types:', error);
      throw error;
    }
  }

  static async reset() {
    try {
      logger.info('Resetting question types...');
      await this.clear();
      await this.seed();
      logger.info('✅ Question types reset completed');
    } catch (error) {
      logger.error('❌ Error resetting question types:', error);
      throw error;
    }
  }
}

module.exports = QuestionTypeSeeder;

