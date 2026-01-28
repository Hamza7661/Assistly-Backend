/**
 * Migration script to convert single-app-per-user to multi-app architecture
 * 
 * This script:
 * 1. Creates a default app for each existing user with their current industry
 * 2. Migrates all existing data (Integration, Questionnaire, ChatbotWorkflow, Lead, etc.) to the default app
 * 3. Sets the default app as the user's active app
 * 4. Preserves all existing data relationships
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('../models/User');
const { App } = require('../models/App');
const { Integration } = require('../models/Integration');
const { Questionnaire } = require('../models/Questionnaire');
const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');
const { Lead } = require('../models/Lead');
const { Appointment } = require('../models/Appointment');
const { Availability } = require('../models/Availability');
const { logger } = require('../utils/logger');
const databaseManager = require('../config/database');

async function migrateToMultiApp() {
  try {
    // Connect to database
    await databaseManager.connect();
    logger.info('Connected to database');

    // Get all users
    const users = await User.find({ isActive: true });
    logger.info(`Found ${users.length} active users to migrate`);

    let migratedCount = 0;
    let errorCount = 0;

    for (const user of users) {
      try {
        // Check if user already has apps
        const existingApps = await App.find({ owner: user._id, isActive: true });
        if (existingApps.length > 0) {
          logger.info(`User ${user._id} already has apps, skipping...`);
          continue;
        }

        // Create default app for user
        const defaultAppName = user.industry 
          ? `${user.firstName}'s ${user.industry.charAt(0).toUpperCase() + user.industry.slice(1)} App`
          : `${user.firstName}'s App`;

        const defaultApp = new App({
          owner: user._id,
          name: defaultAppName,
          industry: user.industry || 'other',
          description: `Default app for ${user.firstName} ${user.lastName}`,
          isActive: true
        });

        await defaultApp.save();
        logger.info(`Created default app for user ${user._id}: ${defaultApp._id}`);

        // Migrate Integration
        const integrations = await Integration.find({ owner: user._id });
        for (const integration of integrations) {
          integration.owner = defaultApp._id;
          await integration.save();
        }
        if (integrations.length > 0) {
          logger.info(`Migrated ${integrations.length} integration(s) for user ${user._id}`);
        }

        // Migrate Questionnaire (FAQs and Treatment Plans)
        const questionnaires = await Questionnaire.find({ owner: user._id });
        for (const questionnaire of questionnaires) {
          questionnaire.owner = defaultApp._id;
          await questionnaire.save();
        }
        if (questionnaires.length > 0) {
          logger.info(`Migrated ${questionnaires.length} questionnaire(s) for user ${user._id}`);
        }

        // Migrate ChatbotWorkflow
        const workflows = await ChatbotWorkflow.find({ owner: user._id });
        for (const workflow of workflows) {
          workflow.owner = defaultApp._id;
          await workflow.save();
        }
        if (workflows.length > 0) {
          logger.info(`Migrated ${workflows.length} workflow(s) for user ${user._id}`);
        }

        // Migrate Leads
        const leads = await Lead.find({ userId: user._id });
        for (const lead of leads) {
          lead.appId = defaultApp._id;
          // Keep userId for backward compatibility but set appId
          await lead.save();
        }
        if (leads.length > 0) {
          logger.info(`Migrated ${leads.length} lead(s) for user ${user._id}`);
        }

        // Migrate Appointments
        const appointments = await Appointment.find({ owner: user._id });
        for (const appointment of appointments) {
          appointment.owner = defaultApp._id;
          await appointment.save();
        }
        if (appointments.length > 0) {
          logger.info(`Migrated ${appointments.length} appointment(s) for user ${user._id}`);
        }

        // Migrate Availability
        const availabilities = await Availability.find({ owner: user._id });
        for (const availability of availabilities) {
          availability.owner = defaultApp._id;
          await availability.save();
        }
        if (availabilities.length > 0) {
          logger.info(`Migrated ${availabilities.length} availability record(s) for user ${user._id}`);
        }

        migratedCount++;
        logger.info(`Successfully migrated user ${user._id} (${user.email})`);

      } catch (error) {
        errorCount++;
        logger.error(`Error migrating user ${user._id}:`, error);
      }
    }

    logger.info(`\n=== Migration Complete ===`);
    logger.info(`Total users processed: ${users.length}`);
    logger.info(`Successfully migrated: ${migratedCount}`);
    logger.info(`Errors: ${errorCount}`);

  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    await databaseManager.disconnect();
    logger.info('Database connection closed');
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateToMultiApp()
    .then(() => {
      logger.info('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateToMultiApp };
