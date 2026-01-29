/**
 * Setup Biryani Waala flow for app under libra_dn@hotmail.com
 * Flow: Lead type → Service plan (treatment plan) → Conversation flow (workflow) → Lead generation
 * Includes allergy-free food service plan and conversation flow.
 */

const mongoose = require('mongoose');
const dns = require('dns');
const { User } = require('../models/User');
const { App } = require('../models/App');
const { Integration } = require('../models/Integration');
const { Questionnaire } = require('../models/Questionnaire');
const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');
const { QUESTIONNAIRE_TYPES } = require('../enums/questionnaireTypes');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const TARGET_EMAIL = 'libra_dn@hotmail.com';

// Biryani Waala lead types: each shows 2-4 relevant services (graceful filtering)
// Rule: Always show at least 2 options for natural choice
const BIRYANIWAALA_LEAD_TYPES = [
  // "order for delivery or pickup" → show 3 ordering methods
  { 
    id: 1, 
    value: 'order-delivery-pickup', 
    text: 'I want to place an order for delivery or pickup', 
    isActive: true, 
    order: 0,
    relevantServicePlans: ['Delivery service', 'Pickup service', 'Dine-in experience']
  },
  // "catering" → show Catering + Allergy (events often need dietary accommodations)
  { 
    id: 2, 
    value: 'catering', 
    text: 'I need catering services for an event', 
    isActive: true, 
    order: 1,
    relevantServicePlans: ['Catering package', 'Allergy-free & dietary options']
  },
  // "dining reservation" → show Dine-in + Allergy (dining out with dietary needs)
  { 
    id: 3, 
    value: 'dining-reservation', 
    text: 'I would like to make a dining reservation', 
    isActive: true, 
    order: 2,
    relevantServicePlans: ['Dine-in experience', 'Allergy-free & dietary options']
  },
  // "menu and specials" → show all ordering + catering (4 services)
  { 
    id: 4, 
    value: 'menu-specials', 
    text: 'I want to see your menu and special items', 
    isActive: true, 
    order: 3,
    relevantServicePlans: ['Delivery service', 'Pickup service', 'Dine-in experience', 'Catering package']
  },
  // "allergies" → show Allergy + any 2 ordering methods (needs safe food options)
  { 
    id: 5, 
    value: 'allergy-dietary', 
    text: 'I have allergies or dietary requirements to discuss', 
    isActive: true, 
    order: 4,
    relevantServicePlans: ['Allergy-free & dietary options', 'Delivery service', 'Pickup service']
  }
];

// Service plans (treatment plans) – question = display name sent to AI
const SERVICE_PLANS = [
  { question: 'Dine-in experience', answer: 'Enjoy our authentic biryani and full menu in our cozy restaurant at 326 Balham High Road, Tooting London SW17 7AA. Perfect for a memorable dining experience.', order: 0 },
  { question: 'Delivery service', answer: 'Fresh biryani delivered to your doorstep in London. Order online or call 0203 411 0065.', order: 1 },
  { question: 'Pickup service', answer: 'Place your order and collect from our restaurant. Fast and convenient.', order: 2 },
  { question: 'Catering package', answer: 'Exceptional catering for events: Chicken Biryani, Beef Biryani, Mutton Korma, Haleem, Butter Chicken and more. Customisable menus.', order: 3 },
  { question: 'Allergy-free & dietary options', answer: 'We take allergies and dietary needs seriously. Nut-free, gluten-free, halal, vegetarian and custom options available. Tell us your requirements.', order: 4 }
];

// Conversation flow: 5 questions per service for comprehensive lead capture
const WORKFLOW_DEFINITIONS = {
  'Dine-in experience': {
    root: { title: 'Dine-in reservation', question: 'Great choice! Our dining facility offers a cozy atmosphere to enjoy authentic biryani.', order: 0 },
    children: [
      { title: 'Reservation date', question: 'What date would you like to dine with us?', order: 1 },
      { title: 'Reservation time', question: 'What time would you prefer? We are open daily with varying hours.', order: 2 },
      { title: 'Party size', question: 'How many people will be dining?', order: 3 },
      { title: 'Special occasion', question: 'Is this for a special occasion? Birthday, anniversary, celebration, or just a regular meal?', order: 4 },
      { title: 'Dietary needs', question: 'Do you or anyone in your party have any dietary requirements or allergies we should know about?', order: 5 }
    ]
  },
  'Delivery service': {
    root: { title: 'Delivery order', question: 'Perfect! We deliver fresh, hot biryani right to your doorstep in London.', order: 1 },
    children: [
      { title: 'Delivery postcode', question: 'What is your delivery postcode or area?', order: 1 },
      { title: 'Delivery address', question: 'What is your full delivery address?', order: 2 },
      { title: 'Order preference', question: 'What would you like to order? Chicken, Beef, Lamb, or Vegetable Biryani, or something else from our menu?', order: 3 },
      { title: 'Delivery time', question: 'When would you like your order delivered? ASAP or a specific time?', order: 4 },
      { title: 'Special instructions', question: 'Any special instructions for your order or delivery? Spice level, dietary needs, delivery notes, etc.', order: 5 }
    ]
  },
  'Pickup service': {
    root: { title: 'Pickup order', question: 'Excellent! You can collect your order from our restaurant at 326 Balham High Road, Tooting London.', order: 2 },
    children: [
      { title: 'Order items', question: 'What would you like to order? Chicken, Beef, Lamb, or Vegetable Biryani, sides, etc.', order: 1 },
      { title: 'Order size', question: 'What size would you like? Regular, Economy, or 1KG portions available.', order: 2 },
      { title: 'Pickup time', question: 'What time would you like to collect your order?', order: 3 },
      { title: 'Extras', question: 'Would you like to add any extras? Naan, Raita, Green Chutney, drinks, desserts?', order: 4 },
      { title: 'Special requests', question: 'Any special requests for your order? Spice level, dietary requirements, etc.', order: 5 }
    ]
  },
  'Catering package': {
    root: { title: 'Event catering', question: 'Wonderful! Our catering services are perfect for making your event memorable with authentic biryani.', order: 3 },
    children: [
      { title: 'Event type', question: 'What type of event is this? Wedding, corporate, birthday, family gathering, etc.', order: 1 },
      { title: 'Event date', question: 'What is the date of your event?', order: 2 },
      { title: 'Guest count', question: 'Approximately how many guests will you be serving?', order: 3 },
      { title: 'Menu preferences', question: 'Which dishes would you like? Chicken Biryani, Beef Biryani, Mutton Korma, Butter Chicken, Vegetarian options, etc.', order: 4 },
      { title: 'Dietary requirements', question: 'Do any guests have dietary restrictions or food allergies we should accommodate? Halal, vegetarian, nut-free, gluten-free, etc.', order: 5 }
    ]
  },
  'Allergy-free & dietary options': {
    root: { title: 'Dietary accommodations', question: 'We take your safety and dietary needs seriously. Let us make sure we get everything right for you.', order: 4 },
    children: [
      { title: 'Allergy type', question: 'What food allergies do you have? Nuts, dairy, gluten, shellfish, etc.', order: 1 },
      { title: 'Severity', question: 'How severe is the allergy? Mild intolerance, moderate, or severe/life-threatening?', order: 2 },
      { title: 'Dietary preference', question: 'Do you have any dietary preferences? Vegetarian, vegan, halal, low-carb, etc.', order: 3 },
      { title: 'Safe dishes', question: 'Which of our dishes are you interested in? We will confirm which ones are safe for you.', order: 4 },
      { title: 'Additional needs', question: 'Any other dietary concerns or requirements we should know about to ensure your meal is completely safe?', order: 5 }
    ]
  }
};

const GREETING = 'Hi! 👋 This is {assistantName} from Biryani Waala. 🍲 Experience the magic of premium ingredients and authentic biryani—delivered fresh from our kitchen to your table. What would you like to do today?';

async function connectDB() {
  if (process.env.DNS_SERVERS) {
    const dnsServers = process.env.DNS_SERVERS.split(',').map(s => s.trim());
    dns.setServers(dnsServers);
  }
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
  let uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI or MONGO_URI required');
    process.exit(1);
  }
  const standardUri = process.env.MONGODB_URI_STANDARD;
  try {
    await mongoose.connect(uri, options);
    console.log('✅ Connected to MongoDB');
  } catch (srvError) {
    if (srvError.message && (srvError.message.includes('ECONNREFUSED') || srvError.message.includes('ENOTFOUND') || srvError.message.includes('querySrv')) && standardUri) {
      console.log('⚠️  Trying standard connection string...');
      await mongoose.connect(standardUri, options);
      console.log('✅ Connected using standard URI');
    } else {
      throw srvError;
    }
  }
}

async function ensureWorkflowForService(appId, serviceQuestion, def) {
  const existingRoot = await ChatbotWorkflow.findOne({
    owner: appId,
    isRoot: true,
    title: def.root.title
  });
  let rootId;
  if (existingRoot) {
    rootId = existingRoot._id;
    await ChatbotWorkflow.updateOne(
      { _id: rootId },
      { $set: { question: def.root.question, order: def.root.order, isActive: true, updatedAt: new Date() } }
    );
    await ChatbotWorkflow.deleteMany({ owner: appId, workflowGroupId: rootId });
  } else {
    const root = new ChatbotWorkflow({
      owner: appId,
      title: def.root.title,
      question: def.root.question,
      questionTypeId: 1,
      isRoot: true,
      order: def.root.order,
      workflowGroupId: null,
      isActive: true
    });
    await root.save();
    root.workflowGroupId = root._id;
    await root.save();
    rootId = root._id;
  }
  const childDocs = def.children.map((c, idx) => ({
    owner: appId,
    title: c.title,
    question: c.question,
    questionTypeId: 1,
    isRoot: false,
    order: c.order,
    workflowGroupId: rootId,
    isActive: true
  }));
  await ChatbotWorkflow.insertMany(childDocs);
  return rootId;
}

async function run() {
  await connectDB();
  const user = await User.findByEmail(TARGET_EMAIL);
  if (!user) {
    console.error(`❌ User not found for email: ${TARGET_EMAIL}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`✓ Found user: ${user.firstName} ${user.lastName} (${user.email})`);
  // Prefer app named like "Biryani" if present, else most recent active app
  let app = await App.findOne({ owner: user._id, isActive: true, name: /biryani/i }).sort({ createdAt: -1 });
  if (!app) {
    app = await App.findOne({ owner: user._id, isActive: true }).sort({ createdAt: -1 });
  }
  if (!app) {
    console.error('❌ No active app found for this user. Create an app first.');
    await mongoose.disconnect();
    process.exit(1);
  }
  const appId = app._id;
  console.log(`✓ Using app: ${app.name} (${appId})`);

  // 1) Integration: lead types + greeting
  const leadTypeMessages = BIRYANIWAALA_LEAD_TYPES.map((lt, index) => ({
    id: lt.id,
    value: lt.value,
    text: lt.text,
    isActive: lt.isActive !== false,
    order: lt.order !== undefined ? lt.order : index,
    ...(Array.isArray(lt.relevantServicePlans) && lt.relevantServicePlans.length > 0 && { relevantServicePlans: lt.relevantServicePlans })
  }));
  await Integration.findOneAndUpdate(
    { owner: appId },
    {
      $set: {
        leadTypeMessages,
        greeting: GREETING,
        assistantName: 'AI Assistant',
        companyName: 'Biryani Waala',
        primaryColor: '#EAB308',
        validateEmail: true,
        validatePhoneNumber: true
      }
    },
    { upsert: true, new: true, runValidators: true }
  );
  console.log('✓ Integration updated: 5 lead types (2-4 services each) + greeting');

  // 2) Workflows per service (root + 5 children)
  const workflowIdByService = {};
  for (const plan of SERVICE_PLANS) {
    const def = WORKFLOW_DEFINITIONS[plan.question];
    if (!def) continue;
    const rootId = await ensureWorkflowForService(appId, plan.question, def);
    workflowIdByService[plan.question] = rootId;
  }
  console.log('✓ Workflows created/updated: ALL 5 services now have 5 conversation questions');

  // 3) Treatment plans (service plans) with attached workflows
  for (const plan of SERVICE_PLANS) {
    const rootId = workflowIdByService[plan.question];
    if (!rootId) continue;
    const existing = await Questionnaire.findOne({
      owner: appId,
      type: QUESTIONNAIRE_TYPES.TREATMENT_PLAN,
      question: plan.question
    });
    const doc = {
      owner: appId,
      type: QUESTIONNAIRE_TYPES.TREATMENT_PLAN,
      question: plan.question,
      answer: plan.answer,
      isActive: true,
      attachedWorkflows: [{ workflowId: rootId, order: 0 }]
    };
    if (existing) {
      await Questionnaire.updateOne(
        { _id: existing._id },
        { $set: { answer: plan.answer, attachedWorkflows: doc.attachedWorkflows, isActive: true } }
      );
      console.log(`  Updated treatment plan: ${plan.question}`);
    } else {
      await Questionnaire.create(doc);
      console.log(`  Created treatment plan: ${plan.question}`);
    }
  }
  console.log('✓ All service plans linked to conversation flows (5 questions each)');

  // 4) Optional: ensure a few Biryani Waala FAQs exist (merge, don't remove existing)
  const faqsToAdd = [
    { question: 'Do you cater for allergies and dietary requirements?', answer: 'Yes. We take allergies seriously. We offer nut-free, gluten-free, halal and vegetarian options. Please tell us your requirements when ordering or choose "Allergy-free & dietary options" in the chat.' },
    { question: 'Where do you deliver?', answer: 'We deliver across London. Share your postcode in the chat or call 0203 411 0065 to confirm we can reach you.' },
    { question: 'Can I order for collection?', answer: 'Yes. Choose "Pickup service" and we will have your order ready at our restaurant at 326 Balham High Road, Tooting London SW17 7AA.' }
  ];
  for (const faq of faqsToAdd) {
    const exists = await Questionnaire.findOne({
      owner: appId,
      type: QUESTIONNAIRE_TYPES.FAQ,
      question: faq.question
    });
    if (!exists) {
      await Questionnaire.create({
        owner: appId,
        type: QUESTIONNAIRE_TYPES.FAQ,
        question: faq.question,
        answer: faq.answer,
        isActive: true
      });
      console.log(`  Added FAQ: ${faq.question.substring(0, 50)}...`);
    }
  }
  console.log('✓ FAQs ensured');

  console.log('\n✅ Biryani Waala flow setup complete (graceful filtering + 5 questions per service).');
  console.log('   Lead type → 2-4 Service plans → 5 Conversation questions → Lead generation');
  console.log('   Run script: node src/scripts/setupBiryaniWaalaFlow.js');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (err) => {
  console.error('❌', err);
  await mongoose.disconnect();
  process.exit(1);
});
