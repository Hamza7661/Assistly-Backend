/**
 * Monthly (or manual) AppPlan quota reset.
 * Only resets channels where: resetCycle !== 'never', paymentCleared === true, resetAt <= now.
 *
 * Run: node src/scripts/resetQuotas.js
 */

const mongoose = require('mongoose');
const dns = require('dns');
const { resetDueQuotas } = require('../services/quotaResetService');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

async function connectDB() {
  if (process.env.DNS_SERVERS) {
    dns.setServers(process.env.DNS_SERVERS.split(',').map(s => s.trim()));
  }
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log('Connected to MongoDB');
}

async function run() {
  await connectDB();
  const { updatedPlans } = await resetDueQuotas(new Date());

  console.log(`Done. Updated ${updatedPlans} app plan(s).`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
