/**
 * Script to clear cache for a specific app
 * This is useful after migrating phone numbers or updating app settings
 * 
 * Usage: node src/scripts/clearAppCache.js <appId>
 * Example: node src/scripts/clearAppCache.js 507f1f77bcf86cd799439011
 */

const cacheManager = require('../utils/cache');

async function clearAppCache(appId) {
  try {
    await cacheManager.connect();

    if (!cacheManager.isConnected) {
      console.log('⚠️  Redis is not connected. Cache clearing skipped.');
      console.log('   If you\'re not using Redis, this is normal.');
      process.exit(0);
    }

    const cacheKey = cacheManager.getAppContextKey(appId);
    const deleted = await cacheManager.del(cacheKey);

    if (deleted) {
      console.log(`✅ Cache cleared for app: ${appId}`);
      console.log(`   Cache key: ${cacheKey}`);
    } else {
      console.log(`⚠️  No cache found for app: ${appId}`);
      console.log(`   Cache key: ${cacheKey}`);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await cacheManager.disconnect();
    process.exit(0);
  }
}

// Main execution
const appId = process.argv[2];

if (!appId) {
  console.error('\n❌ Usage: node src/scripts/clearAppCache.js <appId>');
  console.error('   Example: node src/scripts/clearAppCache.js 507f1f77bcf86cd799439011\n');
  process.exit(1);
}

clearAppCache(appId);
