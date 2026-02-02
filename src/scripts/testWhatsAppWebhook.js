/**
 * Script to test if WhatsApp webhook context lookup is working
 * This simulates what happens when a WhatsApp message arrives
 * 
 * Usage: node src/scripts/testWhatsAppWebhook.js <twilioPhoneNumber>
 * Example: node src/scripts/testWhatsAppWebhook.js +447400485383
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { App } = require('../models/App');
const { Integration } = require('../models/Integration');
const { Questionnaire, QUESTIONNAIRE_TYPES } = require('../models/Questionnaire');

async function testWhatsAppWebhook(twilioPhoneNumber) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    console.log(`\n🔍 Testing WhatsApp webhook context lookup for: ${twilioPhoneNumber}\n`);

    // Step 1: Find app by Twilio phone number
    const app = await App.findByTwilioPhone(twilioPhoneNumber)
      .populate('owner', 'firstName lastName professionDescription website email')
      .select('_id name industry owner twilioPhoneNumber isActive')
      .exec();

    if (!app) {
      console.error(`❌ No app found with Twilio phone number: ${twilioPhoneNumber}`);
      console.log('\n💡 Make sure you ran the migration script:');
      console.log('   node src/scripts/moveTwilioPhoneToApp.js <userEmail> [appName]\n');
      process.exit(1);
    }

    if (!app.isActive) {
      console.error(`❌ App found but is NOT ACTIVE: ${app.name}`);
      process.exit(1);
    }

    console.log(`✅ App found: ${app.name}`);
    console.log(`   App ID: ${app._id}`);
    console.log(`   Industry: ${app.industry}`);
    console.log(`   Active: ${app.isActive}`);
    console.log(`   Owner: ${app.owner.firstName} ${app.owner.lastName} (${app.owner.email})`);

    const appId = app._id;
    const userId = app.owner._id;

    // Step 2: Check for Integration (app-scoped first, then user-scoped)
    let integration = await Integration.findOne({ owner: appId }).exec();
    let integrationScope = 'app';
    
    if (!integration) {
      integration = await Integration.findOne({ owner: userId }).exec();
      integrationScope = 'user';
    }

    if (!integration) {
      console.log(`\n⚠️  No Integration found for app or user`);
      console.log(`   Greeting will use default from environment variable`);
    } else {
      console.log(`\n✅ Integration found (${integrationScope}-scoped)`);
      console.log(`   Assistant Name: ${integration.assistantName}`);
      console.log(`   Company Name: ${integration.companyName}`);
      console.log(`   Greeting: ${integration.greeting}`);
      console.log(`   Validate Email: ${integration.validateEmail}`);
      console.log(`   Validate Phone: ${integration.validatePhoneNumber}`);
      console.log(`   Lead Types: ${integration.leadTypeMessages?.length || 0} custom types`);
    }

    // Step 3: Check for Service Plans (Treatment Plans)
    const servicePlans = await Questionnaire.find({ 
      owner: appId, 
      type: QUESTIONNAIRE_TYPES.SERVICE_PLAN, 
      isActive: true 
    })
      .select('question')
      .exec();

    console.log(`\n✅ Service Plans: ${servicePlans.length} active`);
    if (servicePlans.length > 0) {
      servicePlans.forEach((sp, i) => {
        console.log(`   ${i + 1}. ${sp.question}`);
      });
    }

    // Step 4: Check for FAQs
    const faqs = await Questionnaire.find({ 
      owner: appId, 
      type: QUESTIONNAIRE_TYPES.FAQ, 
      isActive: true 
    })
      .select('question')
      .exec();

    console.log(`\n✅ FAQs: ${faqs.length} active`);
    if (faqs.length > 0 && faqs.length <= 5) {
      faqs.forEach((faq, i) => {
        console.log(`   ${i + 1}. ${faq.question}`);
      });
    } else if (faqs.length > 5) {
      console.log(`   (showing first 5 of ${faqs.length})`);
      faqs.slice(0, 5).forEach((faq, i) => {
        console.log(`   ${i + 1}. ${faq.question}`);
      });
    }

    console.log(`\n✅ Context lookup successful!`);
    console.log(`\n📝 Summary:`);
    console.log(`   - App: ${app.name} (${app.industry})`);
    console.log(`   - User: ${app.owner.firstName} ${app.owner.lastName}`);
    console.log(`   - Integration: ${integration ? 'Found (' + integrationScope + '-scoped)' : 'Not found (using defaults)'}`);
    console.log(`   - Service Plans: ${servicePlans.length}`);
    console.log(`   - FAQs: ${faqs.length}`);
    console.log(`\n✅ WhatsApp webhook should work now!`);
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Restart your backend server to apply code changes`);
    console.log(`   2. Send a WhatsApp message to: ${twilioPhoneNumber}`);
    console.log(`   3. Check the AI service logs for any errors\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

// Main execution
const twilioPhoneNumber = process.argv[2];

if (!twilioPhoneNumber) {
  console.error('\n❌ Usage: node src/scripts/testWhatsAppWebhook.js <twilioPhoneNumber>');
  console.error('   Example: node src/scripts/testWhatsAppWebhook.js +447400485383\n');
  process.exit(1);
}

testWhatsAppWebhook(twilioPhoneNumber);
