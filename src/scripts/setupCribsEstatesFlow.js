/**
 * Cribs Estates — Full Lead / Service / Workflow Seed Script
 * App ID: 69dbdf3d8028cdc66acc4718
 *
 * Data relationship (mirroring facelism app 69c66058368e86658993de00):
 *
 *   Integration.leadTypeMessages[].relevantServicePlans   (array of strings)
 *       └── must EXACTLY match Questionnaire.question     (SERVICE_PLAN, type:2)
 *             └── Questionnaire.attachedWorkflows[].workflowId  (ObjectId)
 *                   └── ChatbotWorkflow (isRoot:true, workflowGroupId = self._id)
 *                         └── ChatbotWorkflow children (isRoot:false, workflowGroupId = root._id)
 *
 * Run:  node src/scripts/setupCribsEstatesFlow.js
 */

const mongoose = require('mongoose');
const dns = require('dns');
const { App } = require('../models/App');
const { Integration } = require('../models/Integration');
const { Questionnaire } = require('../models/Questionnaire');
const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');
const { QUESTIONNAIRE_TYPES } = require('../enums/questionnaireTypes');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const TARGET_APP_ID = '69dbdf3d8028cdc66acc4718';

// ─── GREETING ─────────────────────────────────────────────────────────────────
const GREETING =
  "Hi! 👋 I'm {assistantName} from {companyName}. Whether you're looking to buy, sell, rent, or manage a property in South London, I'm here to help. How can I assist you today?";

// ─── LEAD TYPES → Integration.leadTypeMessages ────────────────────────────────
// relevantServicePlans MUST exactly match Questionnaire.question strings below
const LEAD_TYPES = [
  {
    id: 1,
    value: 'buyer',
    text: 'I am looking to buy a property',
    emoji: '🏠',
    isActive: true,
    order: 0,
    synonyms: [],
    relevantServicePlans: ['Residential Sales', 'Commercial Sales', 'Free Valuation']
  },
  {
    id: 2,
    value: 'seller',
    text: 'I want to sell my property',
    emoji: '🏷️',
    isActive: true,
    order: 1,
    synonyms: [],
    relevantServicePlans: ['Residential Sales', 'Commercial Sales', 'Free Valuation']
  },
  {
    id: 3,
    value: 'landlord',
    text: 'I am a landlord looking for services',
    emoji: '🔑',
    isActive: true,
    order: 2,
    synonyms: [],
    relevantServicePlans: [
      'Full Property Management',
      'Let Only Service',
      'First Time Landlord Advice',
      'Landlord Rent Guarantee Insurance',
      'Design & Refurbishment'
    ]
  },
  {
    id: 4,
    value: 'tenant',
    text: 'I am looking to rent a property',
    emoji: '🏢',
    isActive: true,
    order: 3,
    synonyms: [],
    relevantServicePlans: ['Residential Lettings', 'Commercial Lettings', 'Rooms to Rent']
  },
  {
    id: 5,
    value: 'hmo-investor',
    text: 'I am interested in HMO properties',
    emoji: '🏘️',
    isActive: true,
    order: 4,
    synonyms: [],
    relevantServicePlans: ['HMO Advisory', 'Full Property Management']
  },
  {
    id: 6,
    value: 'valuation',
    text: 'I would like a property valuation',
    emoji: '📊',
    isActive: true,
    order: 5,
    synonyms: [],
    relevantServicePlans: ['Free Valuation']
  },
  {
    id: 7,
    value: 'repair-maintenance',
    text: 'I need to report a repair or maintenance issue',
    emoji: '🔧',
    isActive: true,
    order: 6,
    synonyms: [],
    relevantServicePlans: ['Property Repair & Maintenance']
  }
];

// ─── SERVICE PLANS → Questionnaire (type: SERVICE_PLAN / type:2) ──────────────
// question: MUST exactly match the strings used in relevantServicePlans above
// workflowTitle: must match a key in WORKFLOW_DEFINITIONS below
const SERVICE_PLANS = [
  {
    question: 'Residential Lettings',
    answer:
      'Comprehensive residential lettings service across South London including Wimbledon, Morden, Croydon, Mitcham, Richmond and Sutton. Our team finds the right tenant, manages references, and handles all paperwork.',
    workflowTitle: 'Residential Lettings Workflow'
  },
  {
    question: 'Commercial Lettings',
    answer:
      'Commercial property lettings across South London. Whether you need office, retail, or industrial space, we match you with the right property.',
    workflowTitle: 'Commercial Lettings Workflow'
  },
  {
    question: 'Rooms to Rent',
    answer:
      'Individual rooms to rent across South London. Ideal for single occupants looking for affordable, flexible accommodation.',
    workflowTitle: 'Rooms to Rent Workflow'
  },
  {
    question: 'Residential Sales',
    answer:
      'Expert residential sales service covering all of South London. Whether buying or selling, our experienced agents guide you through every step.',
    workflowTitle: 'Residential Sales Workflow'
  },
  {
    question: 'Commercial Sales',
    answer:
      'Commercial property sales across South London. From retail units to office blocks, our team handles every aspect of your commercial transaction.',
    workflowTitle: 'Commercial Sales Workflow'
  },
  {
    question: 'Full Property Management',
    answer:
      'Full management covers everything — tenant finding, rent collection, maintenance, inspections, and legal compliance. Sit back while we manage your investment.',
    workflowTitle: 'Property Management Workflow'
  },
  {
    question: 'Let Only Service',
    answer:
      'We find and reference the right tenant for your property. We handle marketing, viewings, referencing and move-in, then hand over to you.',
    workflowTitle: 'Let Only Workflow'
  },
  {
    question: 'First Time Landlord Advice',
    answer:
      'New to letting? Our team guides you through your legal obligations, licensing requirements, and best practices to protect your investment and tenants.',
    workflowTitle: 'First Time Landlord Workflow'
  },
  {
    question: 'Landlord Rent Guarantee Insurance',
    answer:
      'Protect your rental income with landlord rent guarantee insurance. We advise on the right cover and help you set up a policy that keeps you protected.',
    workflowTitle: 'Property Management Workflow'
  },
  {
    question: 'HMO Advisory',
    answer:
      'Thinking about converting to a House in Multiple Occupation? Our specialists advise on licensing, planning, compliance, and management to maximise returns.',
    workflowTitle: 'HMO Workflow'
  },
  {
    question: 'Free Valuation',
    answer:
      'Free, no-obligation property valuation from our experienced South London agents. We provide an accurate market appraisal for sale or rental purposes.',
    workflowTitle: 'Valuation Workflow'
  },
  {
    question: 'Design & Refurbishment',
    answer:
      'Our design and refurbishment service transforms properties to maximise appeal and value. We manage the full project from design to completion.',
    workflowTitle: 'Design & Refurbishment Workflow'
  },
  {
    question: 'Property Repair & Maintenance',
    answer:
      'For existing Cribs Estates tenants: report repairs and maintenance issues here. Our team triages your request and arranges the appropriate contractor.',
    workflowTitle: 'Repair & Maintenance Workflow'
  }
];

// ─── WORKFLOW DEFINITIONS ─────────────────────────────────────────────────────
// Key must exactly match workflowTitle in SERVICE_PLANS above.
// root.title is used for idempotency lookup (unique per app).
// children are sequential questions within the workflow group.
const WORKFLOW_DEFINITIONS = {

  'Residential Lettings Workflow': {
    root: {
      title: 'Residential Lettings',
      question: "Wonderful! I'd love to help you find a rental property. Let me take a few details.",
      order: 1
    },
    children: [
      { title: 'Rental property type',  question: 'Are you looking for a room, a flat, or a house?', order: 1 },
      { title: 'Rental area',           question: 'Which area of South London are you looking in? For example, Wimbledon, Morden, Croydon, Mitcham, Richmond, or Sutton?', order: 2 },
      { title: 'Rental budget',         question: 'What is your monthly rental budget?', order: 3 },
      { title: 'Rental bedrooms',       question: 'How many bedrooms do you need?', order: 4 },
      { title: 'Rental move-in date',   question: 'When do you need to move in?', order: 5 },
      { title: 'Furnished preference',  question: 'Would you prefer the property to be furnished or unfurnished?', order: 6 },
      { title: 'Occupants',             question: 'How many people will be living in the property?', order: 7 }
    ]
  },

  'Commercial Lettings Workflow': {
    root: {
      title: 'Commercial Lettings',
      question: "Great! Let me help you find the right commercial property to let.",
      order: 2
    },
    children: [
      { title: 'Commercial type',     question: 'What type of commercial property are you looking for? For example, office, retail unit, or industrial space?', order: 1 },
      { title: 'Commercial area',     question: 'Which area of South London do you need the property in?', order: 2 },
      { title: 'Commercial size',     question: 'What size of space do you need? (approximate square footage)', order: 3 },
      { title: 'Commercial budget',   question: 'What is your monthly budget for the commercial premises?', order: 4 },
      { title: 'Commercial timeline', question: 'When do you need the property from?', order: 5 }
    ]
  },

  'Rooms to Rent Workflow': {
    root: {
      title: 'Rooms to Rent',
      question: "Of course! Let me help you find a room to rent in South London.",
      order: 3
    },
    children: [
      { title: 'Room area',         question: 'Which area of London are you looking in?', order: 1 },
      { title: 'Room budget',       question: 'What is your monthly budget for the room?', order: 2 },
      { title: 'Room move-in',      question: 'When do you need to move in?', order: 3 },
      { title: 'Room requirements', question: 'Do you have any specific requirements such as en-suite, parking, or bills included?', order: 4 }
    ]
  },

  'Residential Sales Workflow': {
    root: {
      title: 'Residential Sales',
      question: "Excellent! Let me assist you with residential property. I just need a few details.",
      order: 4
    },
    children: [
      { title: 'Buy or sell',          question: 'Are you looking to buy or sell a residential property?', order: 1 },
      { title: 'Sales area',           question: 'Which area of London are you interested in? For example, Wimbledon, Morden, Croydon, Mitcham, Richmond, or Sutton?', order: 2 },
      { title: 'Sales budget',         question: 'What is your budget (if buying) or expected sale price (if selling)?', order: 3 },
      { title: 'Sales bedrooms',       question: 'How many bedrooms does the property have or do you require?', order: 4 },
      { title: 'First time buyer',     question: 'Are you a first-time buyer? (if buying)', order: 5 },
      { title: 'Mortgage in principle',question: 'Do you have a mortgage in principle in place? (if buying)', order: 6 },
      { title: 'Sales timeline',       question: 'What is your ideal timeline for buying or selling?', order: 7 }
    ]
  },

  'Commercial Sales Workflow': {
    root: {
      title: 'Commercial Sales',
      question: "Perfect! Let me help you with commercial property. A few quick questions first.",
      order: 5
    },
    children: [
      { title: 'Commercial buy or sell',  question: 'Are you looking to buy or sell a commercial property?', order: 1 },
      { title: 'Commercial property type',question: 'What type of commercial property is it? For example, office, retail, or industrial?', order: 2 },
      { title: 'Commercial sales area',   question: 'Which area of South London is the property in or are you looking in?', order: 3 },
      { title: 'Commercial price',        question: 'What is your budget or asking price?', order: 4 },
      { title: 'Commercial sales timeline',question: 'What is your timeline for the transaction?', order: 5 }
    ]
  },

  'Property Management Workflow': {
    root: {
      title: 'Property Management',
      question: "Brilliant! Let me gather a few details about your property management needs.",
      order: 6
    },
    children: [
      { title: 'Number of properties',    question: 'How many properties do you currently own or are looking to have managed?', order: 1 },
      { title: 'Property type',           question: 'What type of property is it? For example, residential flat, house, commercial unit, or HMO?', order: 2 },
      { title: 'Property postcode',       question: "What is the property's postcode or area?", order: 3 },
      { title: 'Tenants in situ',         question: 'Do you currently have tenants in the property?', order: 4 },
      { title: 'Rent guarantee interest', question: 'Are you interested in landlord rent guarantee insurance to protect your rental income?', order: 5 },
      { title: 'Refurb interest',         question: 'Do you require any design or refurbishment services before or during the tenancy?', order: 6 }
    ]
  },

  'Let Only Workflow': {
    root: {
      title: 'Let Only Service',
      question: "Of course! Our let only service finds the right tenant for your property. Let me take some details.",
      order: 7
    },
    children: [
      { title: 'Let only postcode',      question: 'What is the property postcode or area?', order: 1 },
      { title: 'Let only property type', question: 'What type of property is it?', order: 2 },
      { title: 'Let only bedrooms',      question: 'How many bedrooms does the property have?', order: 3 },
      { title: 'Expected rent',          question: 'What monthly rental are you expecting?', order: 4 },
      { title: 'Let only tenants',       question: 'Do you currently have tenants, or is the property vacant?', order: 5 }
    ]
  },

  'First Time Landlord Workflow': {
    root: {
      title: 'First Time Landlord',
      question: "Welcome to property letting! Our team is here to guide you every step of the way.",
      order: 8
    },
    children: [
      { title: 'FTL properties count', question: 'How many properties are you planning to let?', order: 1 },
      { title: 'FTL property type',    question: 'What type of property are you planning to let? For example, flat, house, or HMO?', order: 2 },
      { title: 'FTL postcode',         question: 'What is the property postcode or area?', order: 3 },
      { title: 'Buy to let mortgage',  question: 'Do you have a buy-to-let mortgage on the property?', order: 4 },
      { title: 'FTL rent guarantee',   question: 'Would you like to know more about landlord rent guarantee insurance to protect your income?', order: 5 }
    ]
  },

  'HMO Workflow': {
    root: {
      title: 'HMO Advisory',
      question: "Brilliant! Our HMO specialists are here to help. Let me take a few details.",
      order: 9
    },
    children: [
      { title: 'HMO ownership',   question: 'Do you already own the property you are looking to convert to an HMO?', order: 1 },
      { title: 'HMO location',    question: 'What is the property location or postcode?', order: 2 },
      { title: 'HMO rooms',       question: 'How many rooms are you planning to rent out?', order: 3 },
      { title: 'HMO licensing',   question: 'Do you need guidance on HMO licensing and legal requirements?', order: 4 },
      { title: 'HMO management',  question: 'Are you looking for a full management service for the HMO after conversion?', order: 5 }
    ]
  },

  'Valuation Workflow': {
    root: {
      title: 'Free Valuation',
      question: "Brilliant! Let me arrange your free property valuation. I just need a few details.",
      order: 10
    },
    children: [
      { title: 'Valuation type',          question: 'Is this for a sales valuation or a rental valuation?', order: 1 },
      { title: 'Valuation postcode',      question: 'What is the property postcode?', order: 2 },
      { title: 'Valuation property type', question: 'What type of property is it? For example, flat, house, or commercial?', order: 3 },
      { title: 'Valuation bedrooms',      question: 'How many bedrooms does the property have?', order: 4 },
      { title: 'Valuation reason',        question: 'What is your reason for the valuation? For example, looking to sell, remortgage, or general curiosity?', order: 5 }
    ]
  },

  'Design & Refurbishment Workflow': {
    root: {
      title: 'Design & Refurbishment',
      question: "Lovely! Our design and refurbishment team can transform your property. Let me take some details.",
      order: 11
    },
    children: [
      { title: 'Refurb property address', question: 'What is the property address or postcode?', order: 1 },
      { title: 'Refurb work type',        question: 'What type of work are you looking for? For example, full refurbishment, redecoration, kitchen or bathroom refit?', order: 2 },
      { title: 'Refurb budget',           question: 'What is your approximate budget for the project?', order: 3 },
      { title: 'Refurb timeline',         question: 'What is your desired start date or completion date for the works?', order: 4 }
    ]
  },

  'Repair & Maintenance Workflow': {
    root: {
      title: 'Repair & Maintenance',
      question: "I'm sorry to hear you have an issue. Let me get this sorted for you as quickly as possible.",
      order: 12
    },
    children: [
      { title: 'Tenant confirmation',      question: 'Are you a current Cribs Estates tenant?', order: 1 },
      { title: 'Repair property address',  question: 'What is the full address of the property where the repair is needed?', order: 2 },
      { title: 'Repair type',             question: 'What type of repair is needed? For example, plumbing, electrical, heating, structural, or other?', order: 3 },
      { title: 'Repair urgency',          question: 'How urgent is the issue? Is it an emergency, does it need attention within a week, or can it wait?', order: 4 }
    ]
  }
};

// ─── FAQS ─────────────────────────────────────────────────────────────────────
const FAQS = [
  {
    question: 'Which areas of London do you cover?',
    answer: 'We cover South London including Wimbledon, Morden, Croydon, Mitcham, Richmond, Sutton, Raynes Park, Tooting, Carshalton, Cheam, and Kingston. Contact us to confirm coverage for your specific postcode.'
  },
  {
    question: 'How do I arrange a free property valuation?',
    answer: 'Simply select "I would like a property valuation" in our chat and we will gather your details and arrange a free, no-obligation valuation at a time that suits you. Alternatively, call us on +44 20 3441 1571 or email info@cribsestates.co.uk.'
  },
  {
    question: 'What is the difference between full management and let only?',
    answer: 'Our let only service finds and references a tenant for your property. Our full management service does everything — from finding tenants to collecting rent, handling maintenance, carrying out inspections, and dealing with all day-to-day issues on your behalf.'
  },
  {
    question: 'Do you manage HMO properties?',
    answer: 'Yes. We have specialist HMO knowledge including licensing requirements, planning considerations, and management of multi-let properties. Contact us for an HMO consultation.'
  },
  {
    question: 'What landlord insurance do you recommend?',
    answer: 'We recommend landlord rent guarantee insurance to protect your rental income in the event a tenant defaults. We can advise on appropriate cover and connect you with trusted insurance providers.'
  },
  {
    question: 'How long does it typically take to let a property?',
    answer: 'On average, well-presented properties in South London let within 2–4 weeks. Factors such as price, condition, and location can affect this. Our team will advise on realistic timescales and how to present your property competitively.'
  },
  {
    question: 'What are your fees for property management?',
    answer: 'Our fees vary depending on the service — let only or full management — and the property type. Please contact us for a personalised quote. We pride ourselves on transparent, competitive pricing.'
  },
  {
    question: 'Can I report a repair through the chatbot?',
    answer: 'Yes. If you are a current Cribs Estates tenant, select "I need to report a repair or maintenance issue" in the chat and we will capture the details and get this logged with our maintenance team.'
  },
  {
    question: 'Where is your office located?',
    answer: 'Our office is located at 236 Merton High Street, London, SW19 1AU. You can also reach us by phone on +44 20 3441 1571 or by email at info@cribsestates.co.uk. We are open Monday to Friday.'
  },
  {
    question: 'Do you offer design and refurbishment services?',
    answer: 'Yes. Our design and refurbishment team can manage your project from concept to completion — including redecoration, kitchen and bathroom refits, and full property renovations — to maximise your property\'s appeal and value.'
  }
];

// ─── DB CONNECTION ─────────────────────────────────────────────────────────────
async function connectDB() {
  if (process.env.DNS_SERVERS) {
    dns.setServers(process.env.DNS_SERVERS.split(',').map(s => s.trim()));
  }
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) { console.error('MONGODB_URI is required'); process.exit(1); }

  const options = {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 120000,
    connectTimeoutMS: 30000,
    heartbeatFrequencyMS: 10000
  };

  try {
    await mongoose.connect(uri, options);
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    const fallback = process.env.MONGODB_URI_STANDARD;
    if (fallback) {
      console.log('⚠  Retrying with standard URI...');
      await mongoose.connect(fallback, options);
      console.log('✅ Connected via standard URI');
    } else {
      throw err;
    }
  }
}

// ─── ENSURE WORKFLOW ───────────────────────────────────────────────────────────
// Idempotent: updates root, deletes + recreates children on each run.
// Returns the root ObjectId.
async function ensureWorkflow(appId, def) {
  let root = await ChatbotWorkflow.findOne({ owner: appId, isRoot: true, title: def.root.title });

  let rootId;
  if (root) {
    rootId = root._id;
    await ChatbotWorkflow.updateOne(
      { _id: rootId },
      { $set: { question: def.root.question, order: def.root.order, isActive: true, updatedAt: new Date() } }
    );
    await ChatbotWorkflow.deleteMany({ owner: appId, workflowGroupId: rootId, isRoot: false });
    console.log(`  ↻  Updated root: "${def.root.title}"`);
  } else {
    root = new ChatbotWorkflow({
      owner:           appId,
      title:           def.root.title,
      question:        def.root.question,
      questionTypeId:  1,
      isRoot:          true,
      order:           def.root.order,
      workflowGroupId: null,
      isActive:        true
    });
    await root.save();
    // workflowGroupId self-references the root's own _id (mirrors facelism pattern)
    root.workflowGroupId = root._id;
    await root.save();
    rootId = root._id;
    console.log(`  +  Created root: "${def.root.title}"`);
  }

  if (def.children && def.children.length > 0) {
    await ChatbotWorkflow.insertMany(
      def.children.map(c => ({
        owner:           appId,
        title:           c.title,
        question:        c.question,
        questionTypeId:  1,
        isRoot:          false,
        order:           c.order,
        workflowGroupId: rootId,
        isActive:        true
      }))
    );
    console.log(`     └─ ${def.children.length} child question(s) inserted`);
  }

  return rootId;
}

// ─── ENSURE SERVICE PLAN ───────────────────────────────────────────────────────
async function ensureServicePlan(appId, plan, rootId) {
  const existing = await Questionnaire.findOne({
    owner: appId,
    type:  QUESTIONNAIRE_TYPES.SERVICE_PLAN,
    question: plan.question
  });

  const attachedWorkflows = [{ workflowId: rootId, order: 0 }];

  if (existing) {
    await Questionnaire.updateOne(
      { _id: existing._id },
      { $set: { answer: plan.answer, attachedWorkflows, isActive: true, updatedAt: new Date() } }
    );
    console.log(`  ↻  Updated service plan: "${plan.question}"`);
  } else {
    await Questionnaire.create({
      owner:            appId,
      type:             QUESTIONNAIRE_TYPES.SERVICE_PLAN,
      question:         plan.question,
      answer:           plan.answer,
      isActive:         true,
      attachedWorkflows
    });
    console.log(`  +  Created service plan: "${plan.question}"`);
  }
}

// ─── ENSURE FAQ ────────────────────────────────────────────────────────────────
async function ensureFaq(appId, faq) {
  const existing = await Questionnaire.findOne({
    owner: appId,
    type:  QUESTIONNAIRE_TYPES.FAQ,
    question: faq.question
  });
  if (!existing) {
    await Questionnaire.create({
      owner:    appId,
      type:     QUESTIONNAIRE_TYPES.FAQ,
      question: faq.question,
      answer:   faq.answer,
      isActive: true
    });
    console.log(`  +  FAQ: "${faq.question.substring(0, 60)}..."`);
  } else {
    console.log(`  –  FAQ already exists: "${faq.question.substring(0, 60)}..."`);
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
async function run() {
  await connectDB();

  const app = await App.findById(TARGET_APP_ID);
  if (!app) {
    console.error(`❌  App not found: ${TARGET_APP_ID}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const appId = app._id;
  console.log(`\n✓  App: "${app.name}" (${appId})\n`);

  // ── Step 1: Workflows ────────────────────────────────────────────────────────
  console.log('── Step 1: Workflows ───────────────────────────────────────────────');
  const workflowRootIds = {};

  for (const [title, def] of Object.entries(WORKFLOW_DEFINITIONS)) {
    const rootId = await ensureWorkflow(appId, def);
    workflowRootIds[title] = rootId;
  }
  console.log(`\n✓  ${Object.keys(WORKFLOW_DEFINITIONS).length} workflow group(s) ready\n`);

  // ── Step 2: Integration — lead types + greeting ──────────────────────────────
  console.log('── Step 2: Integration (lead types + greeting) ─────────────────────');
  const leadTypeMessages = LEAD_TYPES.map((lt, i) => ({
    id:                   lt.id,
    value:                lt.value,
    text:                 lt.text,
    emoji:                lt.emoji || '',
    isActive:             lt.isActive !== false,
    order:                lt.order !== undefined ? lt.order : i,
    synonyms:             lt.synonyms || [],
    relevantServicePlans: lt.relevantServicePlans || []
  }));

  await Integration.findOneAndUpdate(
    { owner: appId },
    {
      $set: {
        leadTypeMessages,
        greeting:        GREETING,
        assistantName:   'Sophie',
        companyName:     'Cribs Estates',
        primaryColor:    '#c01721',
        validateEmail:   true,
        validatePhoneNumber: true
      }
    },
    { upsert: true, new: true, runValidators: true }
  );
  console.log(`✓  Integration updated: ${leadTypeMessages.length} lead types\n`);

  // ── Step 3: Service plans ────────────────────────────────────────────────────
  console.log('── Step 3: Service Plans ───────────────────────────────────────────');
  for (const plan of SERVICE_PLANS) {
    const rootId = workflowRootIds[plan.workflowTitle];
    if (!rootId) {
      console.warn(`  ⚠  No workflow root for "${plan.workflowTitle}" — skipping "${plan.question}"`);
      continue;
    }
    await ensureServicePlan(appId, plan, rootId);
  }
  console.log(`\n✓  ${SERVICE_PLANS.length} service plan(s) ready\n`);

  // ── Step 4: FAQs ─────────────────────────────────────────────────────────────
  console.log('── Step 4: FAQs ────────────────────────────────────────────────────');
  for (const faq of FAQS) {
    await ensureFaq(appId, faq);
  }
  console.log(`\n✓  ${FAQS.length} FAQ(s) ensured\n`);

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('✅  Cribs Estates flow setup complete.');
  console.log(`    App:           "${app.name}" (${appId})`);
  console.log(`    Lead types:    ${LEAD_TYPES.length}`);
  console.log(`    Service plans: ${SERVICE_PLANS.length}`);
  console.log(`    Workflows:     ${Object.keys(WORKFLOW_DEFINITIONS).length} groups`);
  console.log(`    FAQs:          ${FAQS.length}`);
  console.log('');
  console.log('    Chain: Lead Type → Service Plan → Workflow Root → Children → Lead');
  console.log('════════════════════════════════════════════════════════════════════');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async err => {
  console.error('❌  Fatal error:', err.message || err);
  await mongoose.disconnect();
  process.exit(1);
});
