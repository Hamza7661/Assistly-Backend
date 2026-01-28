/**
 * Backfill script to update existing FOOD industry apps with correct lead types
 * This script updates Integration lead types for all existing FOOD apps
 */

const mongoose = require('mongoose');
const dns = require('dns');
const { IndustrySeed } = require('../models/IndustrySeed');
const { Integration } = require('../models/Integration');
const { App } = require('../models/App');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

async function backfillFoodAppLeadTypes() {
  try {
    // Configure DNS servers if specified in environment
    if (process.env.DNS_SERVERS) {
      const dnsServers = process.env.DNS_SERVERS.split(',').map(s => s.trim());
      dns.setServers(dnsServers);
      console.log(`DNS servers configured: ${dnsServers.join(', ')}`);
    }

    // Get connection options
    const options = {
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10,
      minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE) || 2,
      serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT) || 5000,
      socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT) || 45000,
      maxIdleTimeMS: parseInt(process.env.MONGODB_MAX_IDLE_TIME) || 30000,
      retryWrites: true,
      w: 'majority',
      autoIndex: process.env.NODE_ENV === 'development'
    };

    // Get MongoDB URI
    let uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
      console.error('MONGODB_URI not found in environment variables');
      process.exit(1);
    }

    // Check if MONGODB_URI_STANDARD is provided as fallback
    const standardUri = process.env.MONGODB_URI_STANDARD;

    console.log('Connecting to MongoDB...');

    // Try to connect with SRV URI first, fallback to standard if DNS fails
    try {
      await mongoose.connect(uri, options);
      console.log('✅ Connected to MongoDB');
    } catch (srvError) {
      if (srvError.message && (srvError.message.includes('ECONNREFUSED') || srvError.message.includes('ENOTFOUND') || srvError.message.includes('querySrv')) && standardUri) {
        console.log('⚠️  SRV connection failed due to DNS issues, attempting standard connection string...');
        uri = standardUri;
        await mongoose.connect(uri, options);
        console.log('✅ Connected to MongoDB using standard connection string');
      } else {
        throw srvError;
      }
    }

    // Get FOOD industry seed data
    const foodSeedData = await IndustrySeed.findOne({ industry: 'food', isActive: true });
    if (!foodSeedData || !foodSeedData.leadTypes || foodSeedData.leadTypes.length === 0) {
      console.error('❌ FOOD industry seed data not found or has no lead types');
      await mongoose.disconnect();
      process.exit(1);
    }

    console.log(`\nFound FOOD seed data with ${foodSeedData.leadTypes.length} lead types`);
    console.log('Lead types:', foodSeedData.leadTypes.map(lt => lt.text).join(', '));

    // Find all FOOD industry apps (check both active and inactive, and case variations)
    const foodApps = await App.find({ 
      $or: [
        { industry: 'food' },
        { industry: 'FOOD' },
        { industry: 'Food' }
      ]
    });
    console.log(`\nFound ${foodApps.length} FOOD industry app(s) (including inactive)`);

    // Also check what industry values exist
    const allIndustries = await App.distinct('industry');
    console.log(`Available industry values in database: ${allIndustries.join(', ')}`);

    if (foodApps.length === 0) {
      console.log('\n⚠️  No FOOD apps found. This could mean:');
      console.log('   1. No apps have been created yet');
      console.log('   2. The industry field uses a different value');
      console.log('   3. All FOOD apps have been deleted');
      console.log('\nWhen you create a new FOOD app, it will automatically get the correct lead types.');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Map seed lead types to Integration leadTypeMessages format
    const leadTypeMessages = foodSeedData.leadTypes.map((lt, index) => ({
      id: lt.id,
      value: lt.value,
      text: lt.text,
      isActive: true,
      order: index
    }));

    let updatedCount = 0;
    let createdCount = 0;
    let skippedCount = 0;

    // Update each app's Integration
    for (const app of foodApps) {
      try {
        // Check if Integration exists and has default lead types
        const existingIntegration = await Integration.findOne({ owner: app._id });
        
        // Check if it has the old default lead types (generic ones)
        const hasDefaultLeadTypes = existingIntegration && 
          existingIntegration.leadTypeMessages && 
          existingIntegration.leadTypeMessages.length > 0 &&
          (existingIntegration.leadTypeMessages[0].text === 'I would like a call back' ||
           existingIntegration.leadTypeMessages[0].text === 'I would like to arrange an appointment' ||
           existingIntegration.leadTypeMessages[0].text === 'I would like further information');

        const result = await Integration.findOneAndUpdate(
          { owner: app._id },
          { 
            $set: { leadTypeMessages: leadTypeMessages }
          },
          { 
            upsert: true, 
            new: true,
            runValidators: true
          }
        );

        if (result) {
          if (!existingIntegration) {
            createdCount++;
            console.log(`✓ Created Integration with correct lead types for app: ${app.name} (${app._id})`);
          } else if (hasDefaultLeadTypes) {
            updatedCount++;
            console.log(`✓ Updated lead types for app: ${app.name} (${app._id}) - replaced default lead types`);
          } else {
            skippedCount++;
            console.log(`⚠ Skipped app: ${app.name} (${app._id}) - already has custom lead types`);
          }
        }
      } catch (error) {
        console.error(`❌ Error updating app ${app.name} (${app._id}):`, error.message);
      }
    }

    console.log(`\n✅ Backfill completed!`);
    console.log(`   - Updated: ${updatedCount} Integration(s)`);
    console.log(`   - Created: ${createdCount} Integration(s)`);
    console.log(`   - Skipped: ${skippedCount} Integration(s) (already customized)`);
    console.log(`   - Total processed: ${foodApps.length} app(s)`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during backfill:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the backfill
backfillFoodAppLeadTypes();
