/**
 * Migration script to fix the unique index on app names
 * This changes the unique index to only apply to active apps,
 * allowing reuse of names from soft-deleted apps
 */

const mongoose = require('mongoose');
const dns = require('dns');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

async function fixAppNameIndex() {
  try {
    // Configure DNS servers if specified in environment (same as database.js)
    if (process.env.DNS_SERVERS) {
      const dnsServers = process.env.DNS_SERVERS.split(',').map(s => s.trim());
      dns.setServers(dnsServers);
      console.log(`DNS servers configured: ${dnsServers.join(', ')}`);
    }

    // Get connection options (same as database.js)
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

    // Check if MONGODB_URI_STANDARD is provided as fallback (same as database.js)
    const standardUri = process.env.MONGODB_URI_STANDARD;

    console.log('Connecting to MongoDB...');

    // Try to connect with SRV URI first, fallback to standard if DNS fails
    try {
      await mongoose.connect(uri, options);
      console.log('✅ Connected to MongoDB');
    } catch (srvError) {
      // If SRV connection fails with DNS error and standard URI is available, try that
      if (srvError.message && (srvError.message.includes('ECONNREFUSED') || srvError.message.includes('ENOTFOUND') || srvError.message.includes('querySrv')) && standardUri) {
        console.log('⚠️  SRV connection failed due to DNS issues, attempting standard connection string...');
        uri = standardUri;
        await mongoose.connect(uri, options);
        console.log('✅ Connected to MongoDB using standard connection string');
      } else {
        throw srvError;
      }
    }

    const db = mongoose.connection.db;
    const collection = db.collection('apps');

    // Get all indexes to find the exact name
    const indexes = await collection.indexes();
    console.log('Current indexes:', indexes.map(idx => idx.name));

    // Find and drop the old unique index on owner + name
    const oldIndex = indexes.find(idx => 
      idx.key && idx.key.owner === 1 && idx.key.name === 1 && idx.unique === true
    );

    if (oldIndex) {
      try {
        await collection.dropIndex(oldIndex.name);
        console.log(`✓ Dropped old unique index: ${oldIndex.name}`);
      } catch (error) {
        console.error('Error dropping old index:', error.message);
      }
    } else {
      console.log('ℹ No existing unique index on owner + name found');
    }

    // Create new partial unique index (only for active apps)
    await collection.createIndex(
      { owner: 1, name: 1 },
      {
        unique: true,
        partialFilterExpression: { isActive: true },
        name: 'owner_1_name_1'
      }
    );
    console.log('✓ Created new partial unique index on owner_1_name_1 (isActive: true only)');

    console.log('\n✅ Index migration completed successfully!');
    console.log('You can now create apps with names from previously deleted apps.');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during migration:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the migration
fixAppNameIndex();
