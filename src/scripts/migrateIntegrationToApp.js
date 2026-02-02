/**
 * Script to migrate Integration from user-scoped to app-scoped
 * This ensures each app has its own Integration settings (greeting, assistant name, etc.)
 * 
 * Usage: node src/scripts/migrateIntegrationToApp.js <userEmail> [appName]
 * Examples:
 *   - Copy user Integration to all user's apps: node src/scripts/migrateIntegrationToApp.js libra_dn@hotmail.com
 *   - Copy user Integration to specific app: node src/scripts/migrateIntegrationToApp.js libra_dn@hotmail.com Biryaniwaala
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { User } = require('../models/User');
const { App } = require('../models/App');
const { Integration } = require('../models/Integration');

async function migrateIntegrationToApp(userEmail, appName) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    console.log(`\n🔄 Migrating Integration for ${userEmail}${appName ? ` to app: ${appName}` : ' to all apps'}\n`);

    // 1. Find the user
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      throw new Error(`❌ User not found with email: ${userEmail}`);
    }

    console.log(`✅ Found user: ${user.firstName} ${user.lastName}`);
    console.log(`   User ID: ${user._id}`);

    // 2. Find user's Integration
    const userIntegration = await Integration.findOne({ owner: user._id });
    if (!userIntegration) {
      console.log(`\n⚠️  No Integration found for user ${userEmail}`);
      console.log(`   Creating default Integrations for apps...\n`);
    } else {
      console.log(`\n✅ Found user Integration:`);
      console.log(`   Assistant Name: ${userIntegration.assistantName}`);
      console.log(`   Company Name: ${userIntegration.companyName}`);
      console.log(`   Greeting: ${userIntegration.greeting.substring(0, 60)}...`);
      console.log(`   Custom Lead Types: ${userIntegration.leadTypeMessages?.length || 0}`);
    }

    // 3. Find user's apps
    let apps;
    if (appName) {
      const app = await App.findOne({ owner: user._id, name: appName, isActive: true });
      if (!app) {
        throw new Error(`❌ App not found: ${appName} for user ${userEmail}`);
      }
      apps = [app];
    } else {
      apps = await App.find({ owner: user._id, isActive: true });
      if (apps.length === 0) {
        throw new Error(`❌ No active apps found for user ${userEmail}`);
      }
    }

    console.log(`\n📱 Found ${apps.length} app(s):`);
    apps.forEach((app, i) => {
      console.log(`   ${i + 1}. ${app.name} (${app.industry}) - ID: ${app._id}`);
    });

    // 4. Migrate Integration to each app
    const results = [];
    for (const app of apps) {
      console.log(`\n🔄 Processing app: ${app.name}...`);

      // Check if app already has Integration
      const existingAppIntegration = await Integration.findOne({ owner: app._id });
      if (existingAppIntegration) {
        console.log(`   ⚠️  App already has Integration, skipping...`);
        results.push({ app: app.name, status: 'skipped', reason: 'already exists' });
        continue;
      }

      // Create new Integration for app (copy from user or create default)
      const newIntegrationData = {
        owner: app._id, // ✅ Link to app, not user
        assistantName: userIntegration?.assistantName || 'Assistant',
        companyName: userIntegration?.companyName || app.name,
        greeting: userIntegration?.greeting || process.env.DEFAULT_GREETING || 'Hi this is {assistantName} your virtual ai assistant from {companyName}. How can I help you today?',
        primaryColor: userIntegration?.primaryColor || process.env.DEFAULT_PRIMARY_COLOR || '#3B82F6',
        validateEmail: userIntegration?.validateEmail ?? true,
        validatePhoneNumber: userIntegration?.validatePhoneNumber ?? true,
        leadTypeMessages: userIntegration?.leadTypeMessages || []
      };

      // Copy chatbot image if exists
      if (userIntegration?.chatbotImage?.data) {
        newIntegrationData.chatbotImage = {
          data: userIntegration.chatbotImage.data,
          contentType: userIntegration.chatbotImage.contentType,
          filename: userIntegration.chatbotImage.filename
        };
      }

      const newIntegration = new Integration(newIntegrationData);
      await newIntegration.save();

      console.log(`   ✅ Created Integration for ${app.name}`);
      console.log(`      Integration ID: ${newIntegration._id}`);
      results.push({ app: app.name, status: 'created', integrationId: newIntegration._id });
    }

    // 5. Ask about deleting user Integration
    console.log(`\n📝 Migration Summary:`);
    results.forEach(r => {
      if (r.status === 'created') {
        console.log(`   ✅ ${r.app}: Integration created (${r.integrationId})`);
      } else {
        console.log(`   ⏭️  ${r.app}: Skipped (${r.reason})`);
      }
    });

    const createdCount = results.filter(r => r.status === 'created').length;
    if (createdCount > 0) {
      console.log(`\n🎉 Successfully migrated Integration to ${createdCount} app(s)!`);
      
      if (userIntegration) {
        console.log(`\n⚠️  IMPORTANT: User Integration still exists (ID: ${userIntegration._id})`);
        console.log(`   You may want to delete it to avoid confusion.`);
        console.log(`   To delete: db.integrations.deleteOne({_id: ObjectId("${userIntegration._id}")})`);
      }
    } else {
      console.log(`\n⚠️  No new Integrations created (all apps already had Integrations)`);
    }

    console.log(`\n💡 Next steps:`);
    console.log(`   1. Remove the fallback code from user.js (lines 399-406 and similar)`);
    console.log(`   2. Restart your backend server`);
    console.log(`   3. Test WhatsApp: each app will use its own Integration settings`);

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
  console.error('\n❌ Usage: node src/scripts/migrateIntegrationToApp.js <userEmail> [appName]');
  console.error('   Examples:');
  console.error('     Copy to all apps: node src/scripts/migrateIntegrationToApp.js libra_dn@hotmail.com');
  console.error('     Copy to specific app: node src/scripts/migrateIntegrationToApp.js libra_dn@hotmail.com Biryaniwaala\n');
  process.exit(1);
}

migrateIntegrationToApp(userEmail, appName);
