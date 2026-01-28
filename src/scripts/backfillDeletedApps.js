/**
 * Migration script to backfill deletedAt field for existing deleted apps
 * This marks all apps with isActive: false as deleted by setting deletedAt timestamp
 */

const mongoose = require('mongoose');
const dns = require('dns');
const { App } = require('../models/App');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

async function backfillDeletedApps() {
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

    // Find all apps that are inactive but don't have deletedAt set
    // These are apps that were deleted before we added the deletedAt field
    const inactiveAppsWithoutDeletedAt = await App.find({
      isActive: false,
      $or: [
        { deletedAt: null },
        { deletedAt: { $exists: false } }
      ]
    });

    console.log(`\nFound ${inactiveAppsWithoutDeletedAt.length} inactive app(s) without deletedAt field`);

    if (inactiveAppsWithoutDeletedAt.length === 0) {
      console.log('No apps need to be migrated. All deleted apps already have deletedAt set.');
      await mongoose.disconnect();
      process.exit(0);
    }

    let updatedCount = 0;

    // Update each app to set deletedAt timestamp
    for (const app of inactiveAppsWithoutDeletedAt) {
      try {
        // Use the app's updatedAt as the deletedAt timestamp (when it was last modified/deleted)
        // Or use current time if updatedAt is not available
        const deletedTimestamp = app.updatedAt || new Date();
        
        await App.findByIdAndUpdate(app._id, {
          $set: { deletedAt: deletedTimestamp }
        });

        updatedCount++;
        console.log(`✓ Marked app as deleted: ${app.name} (${app._id}) - deletedAt: ${deletedTimestamp}`);
      } catch (error) {
        console.error(`❌ Error updating app ${app.name} (${app._id}):`, error.message);
      }
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   - Updated: ${updatedCount} app(s)`);
    console.log(`   - These apps will no longer appear in the inactive apps list`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during migration:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the migration
backfillDeletedApps();
