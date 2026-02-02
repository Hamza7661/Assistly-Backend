/**
 * Script to move Twilio phone number from User model to App model
 * This ensures WhatsApp messages are routed to the correct app with proper context
 * 
 * Usage: node src/scripts/moveTwilioPhoneToApp.js <userEmail> [appName]
 * Examples: 
 *   - Auto-detect app: node src/scripts/moveTwilioPhoneToApp.js libra_dn@hotmail.com
 *   - Specify app: node src/scripts/moveTwilioPhoneToApp.js libra_dn@hotmail.com Biryaniwaala
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { User } = require('../models/User');
const { App } = require('../models/App');

async function moveTwilioPhoneToApp(userEmail, appName) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    console.log(`\n🔄 Moving Twilio phone number for ${userEmail}${appName ? ` to app: ${appName}` : ''}\n`);

    // 1. Find the user
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      throw new Error(`❌ User not found with email: ${userEmail}`);
    }

    console.log(`✅ Found user: ${user.firstName} ${user.lastName}`);
    console.log(`   User ID: ${user._id}`);

    if (!user.twilioPhoneNumber) {
      throw new Error(`❌ User does not have a Twilio phone number set`);
    }

    const twilioPhone = user.twilioPhoneNumber;
    console.log(`📞 Twilio phone number: ${twilioPhone}`);

    // 2. Find the app
    let app;
    if (appName) {
      // If app name is provided, find by name
      app = await App.findOne({ owner: user._id, name: appName, isActive: true });
      if (!app) {
        throw new Error(`❌ App not found: ${appName} for user ${userEmail}`);
      }
    } else {
      // If no app name provided, find user's active apps
      const userApps = await App.find({ owner: user._id, isActive: true });
      
      if (userApps.length === 0) {
        throw new Error(`❌ No active apps found for user ${userEmail}`);
      }
      
      if (userApps.length > 1) {
        console.log(`\n❌ User has multiple apps. Please specify which one:`);
        userApps.forEach((a, i) => {
          console.log(`   ${i + 1}. ${a.name} (${a.industry || 'No industry'})`);
        });
        console.log(`\nUsage: node src/scripts/moveTwilioPhoneToApp.js ${userEmail} "<appName>"`);
        process.exit(1);
      }
      
      app = userApps[0];
      console.log(`✅ Auto-detected app: ${app.name}`);
    }

    console.log(`✅ Found app: ${app.name}`);
    console.log(`   App ID: ${app._id}`);
    console.log(`   Industry: ${app.industry}`);

    // 3. Check if app already has a Twilio phone
    if (app.twilioPhoneNumber) {
      console.log(`⚠️  App already has Twilio phone: ${app.twilioPhoneNumber}`);
      console.log(`   Do you want to overwrite it? (Update manually if needed)`);
      process.exit(0);
    }

    // 4. Check if another app is using this Twilio phone
    const existingApp = await App.findOne({ twilioPhoneNumber: twilioPhone });
    if (existingApp) {
      console.log(`⚠️  WARNING: Another app is already using this Twilio phone:`);
      console.log(`   App: ${existingApp.name} (${existingApp._id})`);
      console.log(`   This would cause a conflict. Please resolve manually.`);
      process.exit(1);
    }

    // 5. Move the phone number to the app
    app.twilioPhoneNumber = twilioPhone;
    await app.save();

    console.log(`\n✅ Successfully moved Twilio phone to app!`);
    console.log(`   ${twilioPhone} → ${app.name}`);

    // 6. Optionally clear it from user (commented out to keep as backup)
    // user.twilioPhoneNumber = null;
    // await user.save();
    // console.log(`✅ Cleared Twilio phone from user profile`);

    console.log(`\n📝 Summary:`);
    console.log(`   User: ${user.firstName} ${user.lastName} (${user.email})`);
    console.log(`   App: ${app.name} (${app.industry})`);
    console.log(`   Twilio Phone: ${twilioPhone}`);
    console.log(`\n🎉 WhatsApp messages to ${twilioPhone} will now route to ${app.name}!`);
    console.log(`   This ensures the bot uses "${app.industry}" context instead of generic "Clinic".`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

// Main execution
const [userEmail, appName] = process.argv.slice(2);

if (!userEmail) {
  console.error('\n❌ Usage: node src/scripts/moveTwilioPhoneToApp.js <userEmail> [appName]');
  console.error('   Examples:');
  console.error('     Auto-detect app: node src/scripts/moveTwilioPhoneToApp.js libra_dn@hotmail.com');
  console.error('     Specify app: node src/scripts/moveTwilioPhoneToApp.js libra_dn@hotmail.com Biryaniwaala\n');
  process.exit(1);
}

moveTwilioPhoneToApp(userEmail, appName);
