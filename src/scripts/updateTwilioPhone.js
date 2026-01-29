/**
 * One-off script: update Assigned Business Phone Number (Twilio) for a user by email.
 * Usage: node src/scripts/updateTwilioPhone.js
 * Requires MONGODB_URI (or MONGO_URI) in .env.
 */

const mongoose = require('mongoose');
const dns = require('dns');
const path = require('path');
const { User } = require('../models/User');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const TARGET_EMAIL = 'libra_dn@hotmail.com';
const NEW_TWILIO_NUMBER = '+447400485383';

async function updateTwilioPhone() {
  try {
    if (process.env.DNS_SERVERS) {
      const dnsServers = process.env.DNS_SERVERS.split(',').map((s) => s.trim());
      dns.setServers(dnsServers);
      console.log(`DNS servers configured: ${dnsServers.join(', ')}`);
    }

    const options = {
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10,
      minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE) || 2,
      serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT) || 5000,
      socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT) || 45000,
      maxIdleTimeMS: parseInt(process.env.MONGODB_MAX_IDLE_TIME) || 30000,
      retryWrites: true,
      w: 'majority',
      autoIndex: process.env.NODE_ENV === 'development',
    };

    let uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
      console.error('MONGODB_URI or MONGO_URI not found in .env');
      process.exit(1);
    }

    const standardUri = process.env.MONGODB_URI_STANDARD;
    console.log('Connecting to MongoDB...');

    try {
      await mongoose.connect(uri, options);
      console.log('✅ Connected to MongoDB');
    } catch (srvError) {
      if (
        srvError.message &&
        (srvError.message.includes('ECONNREFUSED') ||
          srvError.message.includes('ENOTFOUND') ||
          srvError.message.includes('querySrv')) &&
        standardUri
      ) {
        console.log('⚠️  SRV failed, trying standard connection...');
        uri = standardUri;
        await mongoose.connect(uri, options);
        console.log('✅ Connected using standard URI');
      } else {
        throw srvError;
      }
    }

    const user = await User.findOne({ email: TARGET_EMAIL.toLowerCase().trim() });
    if (!user) {
      console.error(`User not found with email: ${TARGET_EMAIL}`);
      await mongoose.disconnect();
      process.exit(1);
    }

    const previous = user.twilioPhoneNumber || '(none)';
    user.twilioPhoneNumber = NEW_TWILIO_NUMBER;
    await user.save({ validateBeforeSave: true });

    console.log(`\n✅ Updated Twilio assigned number for ${TARGET_EMAIL}`);
    console.log(`   Previous: ${previous}`);
    console.log(`   New:      ${NEW_TWILIO_NUMBER}\n`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Script failed:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

updateTwilioPhone();
