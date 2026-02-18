const mongoose = require('mongoose');
const dns = require('dns');
const { IndustrySeed } = require('../models/IndustrySeed');
const { INDUSTRIES } = require('../enums/industries');
const { LEAD_TYPES } = require('../enums/leadTypes');
require('dotenv').config();

// Industry-specific lead types
const INDUSTRY_LEAD_TYPES = {
  DENTAL: [
    { id: 1, value: 'emergency-appointment', text: 'I need an emergency dental appointment' },
    { id: 2, value: 'routine-checkup', text: 'I would like to schedule a routine checkup' },
    { id: 3, value: 'treatment-consultation', text: 'I need a consultation for treatment options' },
    { id: 4, value: 'teeth-whitening', text: 'I\'m interested in teeth whitening services' }
  ],
  HEALTHCARE: [
    { id: 1, value: 'urgent-care', text: 'I need urgent medical attention' },
    { id: 2, value: 'appointment-booking', text: 'I would like to book an appointment' },
    { id: 3, value: 'prescription-refill', text: 'I need a prescription refill' },
    { id: 4, value: 'test-results', text: 'I want to inquire about test results' }
  ],
  REAL_ESTATE: [
    { id: 1, value: 'property-viewing', text: 'I would like to schedule a property viewing' },
    { id: 2, value: 'property-valuation', text: 'I need a property valuation' },
    { id: 3, value: 'list-my-property', text: 'I want to list my property for sale/rent' },
    { id: 4, value: 'mortgage-inquiry', text: 'I have questions about mortgage options' }
  ],
  LEGAL: [
    { id: 1, value: 'legal-consultation', text: 'I need a legal consultation' },
    { id: 2, value: 'document-review', text: 'I need document review services' },
    { id: 3, value: 'case-evaluation', text: 'I want a case evaluation' },
    { id: 4, value: 'contract-drafting', text: 'I need contract drafting assistance' }
  ],
  FOOD: [
    { id: 1, value: 'order', text: 'Order', linkedWorkflow: 'Delivery Order Workflow', linkedService: 'Delivery Order' },
    { id: 2, value: 'menu', text: 'Menu', linkedWorkflow: 'Menu WorkFlow', linkedService: 'Menu Inquiry' },
    { id: 3, value: 'catering', text: 'Catering', linkedWorkflow: 'Catering Flow', linkedService: 'Event Catering Services' },
    { id: 4, value: 'reservation', text: 'Reservation', linkedWorkflow: 'Reservation WorkFlow', linkedService: 'Table Reservation Service' },
    { id: 5, value: 'allergies--halal', text: 'Allergies / Halal', linkedWorkflow: 'Allergies / Halal Workflow', linkedService: 'Allergies/ Halal Inquiry' },
    { id: 6, value: 'info--contact', text: 'Info & Contact', linkedWorkflow: 'Info & Contact Workflow', linkedService: 'Info & Contact' },
    { id: 7, value: 'complaint', text: 'Complaint', linkedWorkflow: 'Complaint Workflow', linkedService: 'Register Complaint' }
  ],
  AUTOMOTIVE: [
    { id: 1, value: 'service-appointment', text: 'I need to schedule a service appointment' },
    { id: 2, value: 'vehicle-inspection', text: 'I need a vehicle inspection' },
    { id: 3, value: 'parts-inquiry', text: 'I\'m looking for specific parts' },
    { id: 4, value: 'emergency-repair', text: 'I need emergency repair services' }
  ],
  BEAUTY: [
    { id: 1, value: 'appointment-booking', text: 'I would like to book an appointment' },
    { id: 2, value: 'service-inquiry', text: 'I want to know about your services' },
    { id: 3, value: 'package-information', text: 'I\'m interested in service packages' },
    { id: 4, value: 'gift-voucher', text: 'I want to purchase a gift voucher' }
  ],
  FITNESS: [
    { id: 1, value: 'membership-inquiry', text: 'I\'m interested in a membership' },
    { id: 2, value: 'personal-training', text: 'I want information about personal training' },
    { id: 3, value: 'trial-session', text: 'I would like to book a trial session' },
    { id: 4, value: 'class-schedule', text: 'I want to see the class schedule' }
  ],
  CONSULTING: [
    { id: 1, value: 'consultation-request', text: 'I would like to schedule a consultation' },
    { id: 2, value: 'service-inquiry', text: 'I want to know about your consulting services' },
    { id: 3, value: 'project-discussion', text: 'I have a project to discuss' },
    { id: 4, value: 'pricing-information', text: 'I need pricing information' }
  ],
  EDUCATION: [
    { id: 1, value: 'course-enrollment', text: 'I want to enroll in a course' },
    { id: 2, value: 'program-information', text: 'I need information about programs' },
    { id: 3, value: 'schedule-inquiry', text: 'I want to know about class schedules' },
    { id: 4, value: 'financial-aid', text: 'I have questions about financial aid' }
  ],
  FINANCE: [
    { id: 1, value: 'financial-consultation', text: 'I need a financial consultation' },
    { id: 2, value: 'investment-advice', text: 'I want investment advice' },
    { id: 3, value: 'retirement-planning', text: 'I need retirement planning services' },
    { id: 4, value: 'account-inquiry', text: 'I have questions about my account' }
  ],
  HOSPITALITY: [
    { id: 1, value: 'room-booking', text: 'I would like to book a room' },
    { id: 2, value: 'event-booking', text: 'I want to book an event venue' },
    { id: 3, value: 'amenities-inquiry', text: 'I want to know about amenities' },
    { id: 4, value: 'special-requests', text: 'I have special requests for my stay' }
  ],
  RETAIL: [
    { id: 1, value: 'product-inquiry', text: 'I\'m looking for a specific product' },
    { id: 2, value: 'store-hours', text: 'I want to know your store hours' },
    { id: 3, value: 'return-policy', text: 'I have questions about return policy' },
    { id: 4, value: 'gift-card', text: 'I want to purchase a gift card' }
  ],
  TECHNOLOGY: [
    { id: 1, value: 'service-inquiry', text: 'I want to know about your services' },
    { id: 2, value: 'technical-support', text: 'I need technical support' },
    { id: 3, value: 'product-demo', text: 'I would like a product demonstration' },
    { id: 4, value: 'custom-solution', text: 'I need a custom technology solution' }
  ],
  OTHER: [
    { id: 1, value: 'general-inquiry', text: 'I have a general inquiry' },
    { id: 2, value: 'service-information', text: 'I want information about your services' },
    { id: 3, value: 'contact-request', text: 'I would like to be contacted' }
  ]
};

// Connect to database (using same connection logic as other scripts)
const connectDB = async () => {
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
    let uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/assistly';
    
    // Check if MONGODB_URI_STANDARD is provided as fallback
    const standardUri = process.env.MONGODB_URI_STANDARD;

    console.log('Connecting to MongoDB...');

    // Try to connect with SRV URI first, fallback to standard if DNS fails
    try {
      await mongoose.connect(uri, options);
      console.log('✅ MongoDB connected');
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
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Default seed data templates for each industry
const seedDataTemplates = {
  [INDUSTRIES.DENTAL]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our dental clinic. How can I help you today?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Appointment Booking',
            question: 'Would you like to book an appointment?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Services Information',
            question: 'Would you like to know about our services?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Emergency',
            question: 'Is this a dental emergency?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What are your office hours?',
        answer: 'Our dental clinic is open Monday through Friday from 9:00 AM to 6:00 PM, and Saturday from 9:00 AM to 2:00 PM. We are closed on Sundays.'
      },
      {
        question: 'Do you accept insurance?',
        answer: 'Yes, we accept most major dental insurance plans. Please bring your insurance card when you visit, and we will verify your coverage.'
      },
      {
        question: 'How often should I get a dental checkup?',
        answer: 'We recommend visiting the dentist every 6 months for a routine checkup and cleaning to maintain good oral health.'
      },
      {
        question: 'What should I do in a dental emergency?',
        answer: 'If you have a dental emergency, please call us immediately. We have emergency appointments available for urgent situations like severe pain, knocked-out teeth, or broken teeth.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.DENTAL,
    servicePlans: [
      {
        name: 'Basic Cleaning',
        description: 'Regular dental cleaning and examination',
        price: { amount: 100, currency: 'USD' }
      },
      {
        name: 'Comprehensive Exam',
        description: 'Complete oral examination including X-rays',
        price: { amount: 150, currency: 'USD' }
      },
      {
        name: 'Teeth Whitening',
        description: 'Professional teeth whitening treatment',
        price: { amount: 300, currency: 'USD' }
      }
    ],
    introduction: 'Hi! 👋 This is {assistantName} from {companyName}. We\'re here to help you keep that beautiful smile healthy and bright! What can we do for you today?'
  },
  [INDUSTRIES.HEALTHCARE]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our healthcare facility. How can I assist you today?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Appointment Booking',
            question: 'Would you like to schedule an appointment?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Services Information',
            question: 'Would you like information about our medical services?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Urgent Care',
            question: 'Do you need urgent medical attention?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What are your clinic hours?',
        answer: 'Our healthcare facility is open Monday through Friday from 8:00 AM to 8:00 PM, and Saturday from 9:00 AM to 5:00 PM. We have 24/7 emergency services available.'
      },
      {
        question: 'Do you accept insurance?',
        answer: 'Yes, we accept most major health insurance plans. Please contact us with your insurance information to verify coverage.'
      },
      {
        question: 'How do I schedule an appointment?',
        answer: 'You can schedule an appointment by calling us, using our online booking system, or speaking with our chatbot. We recommend booking in advance for non-urgent visits.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.HEALTHCARE,
    servicePlans: [
      {
        name: 'General Consultation',
        description: 'Routine medical consultation with a healthcare provider',
        price: { amount: 150, currency: 'USD' }
      },
      {
        name: 'Annual Checkup',
        description: 'Comprehensive annual health examination',
        price: { amount: 250, currency: 'USD' }
      }
    ],
    introduction: 'Hello! 👋 This is {assistantName} from {companyName}. We\'re here to help with all your health needs. How can we assist you today?'
  },
  [INDUSTRIES.REAL_ESTATE]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our real estate agency. How can I help you find your perfect property?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Property Search',
            question: 'Are you looking to buy or rent a property?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Property Listing',
            question: 'Do you want to list your property for sale or rent?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Property Valuation',
            question: 'Would you like to get a property valuation?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What areas do you serve?',
        answer: 'We serve properties throughout the region. Please let us know your preferred location, and we can show you available properties in that area.'
      },
      {
        question: 'What are your commission rates?',
        answer: 'Our commission rates vary depending on the type of transaction. Please contact us for detailed information about our fees and services.'
      },
      {
        question: 'How long does it take to sell a property?',
        answer: 'The time to sell a property varies based on market conditions, location, and pricing. On average, properties sell within 30-90 days when properly priced and marketed.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.REAL_ESTATE,
    servicePlans: [
      {
        name: 'Property Listing',
        description: 'Full-service property listing with professional photography and marketing',
        price: { amount: 500, currency: 'USD' }
      },
      {
        name: 'Property Valuation',
        description: 'Professional property valuation and market analysis',
        price: { amount: 200, currency: 'USD' }
      }
    ],
    introduction: 'Hey there! 👋 This is {assistantName} from {companyName}. Whether you\'re looking to buy, sell, or rent, we\'ve got you covered! How can we help you today?'
  },
  [INDUSTRIES.LEGAL]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our law firm. How can we assist you with your legal needs?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Consultation',
            question: 'Would you like to schedule a legal consultation?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Legal Services',
            question: 'What type of legal service are you looking for?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What areas of law do you practice?',
        answer: 'We practice in various areas including family law, business law, real estate law, and personal injury. Please let us know your specific needs.'
      },
      {
        question: 'How much do consultations cost?',
        answer: 'Initial consultations are typically $150-$300 depending on the complexity of your case. We offer a free 15-minute phone consultation to discuss your situation.'
      },
      {
        question: 'Do you offer payment plans?',
        answer: 'Yes, we understand legal services can be expensive. We offer flexible payment plans for our clients. Please discuss your options during your consultation.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.LEGAL,
    servicePlans: [
      {
        name: 'Initial Consultation',
        description: 'One-hour consultation with an attorney to discuss your legal matter',
        price: { amount: 200, currency: 'USD' }
      },
      {
        name: 'Document Review',
        description: 'Professional review of legal documents',
        price: { amount: 150, currency: 'USD' }
      }
    ],
    introduction: 'Hello! 👋 This is {assistantName} from {companyName}. We\'re here to provide expert legal guidance and help you navigate any legal matters. What can we help you with today?'
  },
  [INDUSTRIES.FOOD]: {
    workflows: [
      {
        title: 'Delivery Order Workflow',
        question: 'Would you like to place an order for delivery? Please share your address and what you would like to order.',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          { title: 'Delivery Order Workflow', question: 'Would you like to place an order for delivery? Please share your address and what you would like to order.', questionTypeId: 1, isRoot: false, order: 0 }
        ]
      },
      {
        title: 'Pickup Order Workflow',
        question: 'Would you like to place an order for pickup? When would you like to collect your order?',
        questionTypeId: 1,
        isRoot: true,
        order: 1,
        children: [
          { title: 'Pickup Order Workflow', question: 'Would you like to place an order for pickup? When would you like to collect your order?', questionTypeId: 1, isRoot: false, order: 0 }
        ]
      },
      {
        title: 'Menu WorkFlow',
        question: 'What would you like to know about our menu? You can ask about dishes, ingredients, portions, or dietary options.',
        questionTypeId: 1,
        isRoot: true,
        order: 2,
        children: [
          { title: 'Menu WorkFlow', question: 'What would you like to know about our menu? You can ask about dishes, ingredients, portions, or dietary options.', questionTypeId: 1, isRoot: false, order: 0 }
        ]
      },
      {
        title: 'Catering Flow',
        question: 'Tell us about your event: date, number of guests, and any dietary requirements. We will suggest a catering package for you.',
        questionTypeId: 1,
        isRoot: true,
        order: 3,
        children: [
          { title: 'Catering Flow', question: 'Tell us about your event: date, number of guests, and any dietary requirements. We will suggest a catering package for you.', questionTypeId: 1, isRoot: false, order: 0 }
        ]
      },
      {
        title: 'Reservation WorkFlow',
        question: 'When would you like to reserve a table? Please share the date, time, and number of guests.',
        questionTypeId: 1,
        isRoot: true,
        order: 4,
        children: [
          { title: 'Reservation WorkFlow', question: 'When would you like to reserve a table? Please share the date, time, and number of guests.', questionTypeId: 1, isRoot: false, order: 0 }
        ]
      },
      {
        title: 'Allergies / Halal Workflow',
        question: 'Do you have any allergies or dietary requirements (e.g. halal, vegetarian)? Please tell us so we can guide you to suitable options.',
        questionTypeId: 1,
        isRoot: true,
        order: 5,
        children: [
          { title: 'Allergies / Halal Workflow', question: 'Do you have any allergies or dietary requirements (e.g. halal, vegetarian)? Please tell us so we can guide you to suitable options.', questionTypeId: 1, isRoot: false, order: 0 }
        ]
      },
      {
        title: 'Info & Contact Workflow',
        question: 'What would you like to know? You can ask about our location, opening hours, or how to get in touch.',
        questionTypeId: 1,
        isRoot: true,
        order: 6,
        children: [
          { title: 'Info & Contact Workflow', question: 'What would you like to know? You can ask about our location, opening hours, or how to get in touch.', questionTypeId: 1, isRoot: false, order: 0 }
        ]
      },
      {
        title: 'Complaint Workflow',
        question: 'We are sorry to hear something was not right. Please describe the issue and your order details so we can help resolve it.',
        questionTypeId: 1,
        isRoot: true,
        order: 7,
        children: [
          { title: 'Complaint Workflow', question: 'We are sorry to hear something was not right. Please describe the issue and your order details so we can help resolve it.', questionTypeId: 1, isRoot: false, order: 0 }
        ]
      }
    ],
    faqs: [
      {
        question: 'What are your operating hours?',
        answer: 'We are open daily for your convenience. Most items are available daily, with special biryanis available on Friday, Saturday, and Sunday. Please contact us for specific hours or visit our website for the most up-to-date information.'
      },
      {
        question: 'Do you offer delivery?',
        answer: 'Yes! We offer convenient delivery service right to your doorstep. You can order through our website or call us directly. We ensure fresh, hot biryani delivered to you in London.'
      },
      {
        question: 'What is your delivery area?',
        answer: 'We deliver throughout London. For specific delivery areas and minimum order requirements, please contact us or check our website. We strive to bring authentic biryani to as many customers as possible.'
      },
      {
        question: 'Do you have vegetarian options?',
        answer: 'Absolutely! We offer delicious Vegetable Biryani in Regular, Economy, and 1KG sizes. We also have vegetarian specials like Palak Paneer, Memoni Daal Chawal, and Vegetable Rice. All our vegetarian options are prepared with the same care and authentic flavors.'
      },
      {
        question: 'What special items are available on weekends?',
        answer: 'We have special weekend items including Deghi Beef Biryani (available Friday, Saturday, Sunday), Beef Nihari, and Zarda dessert. These items are prepared fresh and are very popular, so we recommend ordering in advance.'
      },
      {
        question: 'Do you offer catering services?',
        answer: 'Yes! We provide exceptional catering services for your special events, parties, and gatherings. We offer customizable menus including Chicken Biryani, Beef Biryani, Mutton Korma, Chicken Korma, Beef Nihari, Haleem, Butter Chicken, and Creamy Handi. Contact us to discuss your event needs and we\'ll create the perfect menu for you.'
      },
      {
        question: 'What payment methods do you accept?',
        answer: 'We accept various payment methods including cash, card payments, and online payments through our website. For delivery orders, payment can be made online or upon delivery. For catering services, we can discuss payment options when you book.'
      },
      {
        question: 'Where are you located?',
        answer: 'We are located at 326 Balham High Road, Tooting, London SW17 7AA. We have a cozy dining facility where you can enjoy your meal, or you can order for delivery or pickup. Feel free to visit us or call 0203 411 0065 for directions.'
      },
      {
        question: 'How long does delivery take?',
        answer: 'Delivery times vary based on your location and order volume. Typically, orders are delivered within 30-60 minutes. For larger orders or during peak hours, it may take slightly longer. We always aim to deliver fresh, hot food as quickly as possible.'
      },
      {
        question: 'Can I customize my order?',
        answer: 'Yes! We understand everyone has different preferences. You can customize spice levels, add extras like Naan, Raita, or Green Chutney. For special dietary requirements or allergies, please inform us when placing your order, and we\'ll accommodate your needs.'
      },
      {
        question: 'Do you have a kids menu?',
        answer: 'Yes, we have a kids menu! We offer Chicken Pasta with White Sauce that kids love. We also have smaller portions available for children. Feel free to ask about kid-friendly options when ordering.'
      },
      {
        question: 'What makes your biryani special?',
        answer: 'We take pride in using premium quality ingredients and authentic recipes passed down through generations. Each biryani is prepared fresh daily with aromatic basmati rice, carefully selected spices, and tender meat or vegetables. Our commitment to quality and taste ensures every bite is a culinary delight.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.FOOD,
    servicePlans: [
      {
        name: 'Info & Contact',
        description: 'Info & Contact',
        price: { amount: 0, currency: 'GBP' }
      },
      {
        name: 'Menu Inquiry',
        description: 'Menu',
        price: { amount: 0, currency: 'GBP' }
      },
      {
        name: 'Register Complaint',
        description: 'Register Complaint',
        price: { amount: 0, currency: 'GBP' }
      },
      {
        name: 'Table Reservation Service',
        description: 'Table Reservation Service',
        price: { amount: 0, currency: 'GBP' }
      },
      {
        name: 'Allergies/ Halal Inquiry',
        description: 'Allergies/ Halal Inquiry',
        price: { amount: 0, currency: 'GBP' }
      },
      {
        name: 'Pickup Order',
        description: 'Pickup Order',
        price: { amount: 0, currency: 'GBP' }
      },
      {
        name: 'Delivery Order',
        description: 'Customer wants food delivered to their location',
        price: { amount: 0, currency: 'GBP' }
      },
      {
        name: 'Event Catering Services',
        description: 'Professional catering for weddings, corporate events, parties, and special occasions',
        price: { amount: 0, currency: 'GBP' }
      }
    ],
    introduction: 'Hi! 👋 This is {assistantName} from {companyName}. 🍲 Experience the magic of premium quality ingredients and delectable biryani dishes delivered fresh to your doorstep. From our kitchen to your table, we bring you the rich and aromatic world of authentic biryani. How can we help you today?'
  },
  [INDUSTRIES.AUTOMOTIVE]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our automotive service center. How can I assist you today?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Service Appointment',
            question: 'Would you like to schedule a service appointment?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Vehicle Inspection',
            question: 'Do you need a vehicle inspection or diagnostic?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Parts & Accessories',
            question: 'Are you looking for parts or accessories?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What services do you offer?',
        answer: 'We offer a full range of automotive services including oil changes, tire rotation, brake service, engine diagnostics, and more.'
      },
      {
        question: 'How long does a typical service take?',
        answer: 'Service times vary by type. Oil changes typically take 30-45 minutes, while more complex services may take several hours. We will provide an estimated time when you schedule.'
      },
      {
        question: 'Do you offer warranties on your work?',
        answer: 'Yes, we stand behind our work with comprehensive warranties. All service work comes with a warranty, and we will provide details when you visit.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.AUTOMOTIVE,
    servicePlans: [
      {
        name: 'Basic Service',
        description: 'Oil change and basic inspection',
        price: { amount: 50, currency: 'USD' }
      },
      {
        name: 'Full Service',
        description: 'Comprehensive vehicle service and inspection',
        price: { amount: 150, currency: 'USD' }
      }
    ],
    introduction: 'Hi there! 👋 This is {assistantName} from {companyName}. We\'re here to keep your vehicle running smoothly with quality maintenance and repair services. How can we help you today?'
  },
  [INDUSTRIES.BEAUTY]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our beauty salon. How can I help you look and feel your best today?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Appointment Booking',
            question: 'Would you like to book an appointment?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Services',
            question: 'What beauty service are you interested in?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Pricing',
            question: 'Would you like to know about our pricing?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What services do you offer?',
        answer: 'We offer a wide range of beauty services including haircuts, styling, coloring, facials, manicures, pedicures, and spa treatments.'
      },
      {
        question: 'How far in advance should I book?',
        answer: 'We recommend booking at least 1-2 weeks in advance, especially for popular services and weekend appointments.'
      },
      {
        question: 'Do you use organic or natural products?',
        answer: 'Yes, we offer both traditional and organic/natural product options. Please let us know your preference when booking.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.BEAUTY,
    servicePlans: [
      {
        name: 'Haircut & Style',
        description: 'Professional haircut and styling',
        price: { amount: 60, currency: 'USD' }
      },
      {
        name: 'Full Service Package',
        description: 'Haircut, color, and styling',
        price: { amount: 150, currency: 'USD' }
      }
    ],
    introduction: 'Hello beautiful! 👋 This is {assistantName} from {companyName}. We\'re here to help you look and feel absolutely amazing! What service are you interested in today?'
  },
  [INDUSTRIES.FITNESS]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our fitness center. How can I help you achieve your fitness goals?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Membership',
            question: 'Are you interested in a membership?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Personal Training',
            question: 'Would you like information about personal training?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Class Schedule',
            question: 'Would you like to see our class schedule?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What are your membership options?',
        answer: 'We offer various membership plans including monthly, annual, and day passes. We also have family and corporate membership options.'
      },
      {
        question: 'Do you offer a free trial?',
        answer: 'Yes, we offer a free 7-day trial for new members. Come in and experience our facilities and classes.'
      },
      {
        question: 'What equipment and facilities do you have?',
        answer: 'We have state-of-the-art equipment including cardio machines, weight training equipment, group fitness studios, and locker rooms.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.FITNESS,
    servicePlans: [
      {
        name: 'Basic Membership',
        description: 'Monthly gym access',
        price: { amount: 50, currency: 'USD' }
      },
      {
        name: 'Premium Membership',
        description: 'Full access including classes and personal training',
        price: { amount: 100, currency: 'USD' }
      }
    ],
    introduction: 'Hey! 💪 This is {assistantName} from {companyName}. We\'re here to help you crush your fitness goals and feel your best! What can we help you with today?'
  },
  [INDUSTRIES.CONSULTING]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our consulting firm. How can we help you with your business needs?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Consultation',
            question: 'Would you like to schedule a consultation?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Services',
            question: 'What type of consulting services are you looking for?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Pricing',
            question: 'Would you like information about our pricing and packages?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What consulting services do you offer?',
        answer: 'We offer a wide range of consulting services including business strategy, management consulting, financial consulting, marketing consulting, and technology consulting.'
      },
      {
        question: 'How do your consulting engagements work?',
        answer: 'We typically start with an initial consultation to understand your needs, followed by a proposal outlining our approach, timeline, and investment. Engagements can be project-based or ongoing retainer relationships.'
      },
      {
        question: 'What industries do you specialize in?',
        answer: 'We work with businesses across various industries including technology, healthcare, finance, retail, and manufacturing. Our consultants have deep expertise in multiple sectors.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.CONSULTING,
    servicePlans: [
      {
        name: 'Initial Consultation',
        description: 'One-hour consultation to discuss your business needs and challenges',
        price: { amount: 200, currency: 'USD' }
      },
      {
        name: 'Strategy Package',
        description: 'Comprehensive business strategy development and implementation plan',
        price: { amount: 5000, currency: 'USD' }
      }
    ],
    introduction: 'Hi! 👋 This is {assistantName} from {companyName}. We help businesses grow and succeed with expert guidance and strategic solutions. How can we help your business today?'
  },
  [INDUSTRIES.EDUCATION]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our educational institution. How can we help you with your learning journey?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Enrollment',
            question: 'Are you interested in enrolling in a course or program?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Course Information',
            question: 'Would you like information about our courses and programs?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Schedule',
            question: 'Would you like to see our class schedules?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What courses or programs do you offer?',
        answer: 'We offer a variety of courses and programs including professional development, certification programs, continuing education, and specialized training courses.'
      },
      {
        question: 'How do I enroll?',
        answer: 'You can enroll online through our website, by phone, or by visiting our office. We accept enrollments throughout the year for most programs.'
      },
      {
        question: 'Do you offer online courses?',
        answer: 'Yes, we offer both in-person and online courses to accommodate different learning preferences and schedules.'
      },
      {
        question: 'What are your tuition fees?',
        answer: 'Tuition fees vary by program. Please contact us for detailed pricing information, and we can also discuss payment plans and financial aid options if available.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.EDUCATION,
    servicePlans: [
      {
        name: 'Single Course',
        description: 'Enrollment in one course',
        price: { amount: 500, currency: 'USD' }
      },
      {
        name: 'Certificate Program',
        description: 'Complete certificate program with multiple courses',
        price: { amount: 2000, currency: 'USD' }
      }
    ],
    introduction: 'Hello! 👋 This is {assistantName} from {companyName}. We\'re dedicated to helping you learn and grow with quality education and training. What would you like to know more about?'
  },
  [INDUSTRIES.FINANCE]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our financial services firm. How can we assist you with your financial needs?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Consultation',
            question: 'Would you like to schedule a financial consultation?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Services',
            question: 'What financial services are you interested in?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Investment Options',
            question: 'Would you like information about investment options?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What financial services do you offer?',
        answer: 'We offer comprehensive financial services including investment advisory, retirement planning, tax planning, estate planning, and wealth management.'
      },
      {
        question: 'What are your fees?',
        answer: 'Our fee structure varies based on the services provided. We offer both fee-based and commission-based options. Please schedule a consultation to discuss your specific needs and our fee structure.'
      },
      {
        question: 'Do you require a minimum investment?',
        answer: 'Minimum investment requirements vary by service and investment product. We work with clients at various asset levels and can discuss options that fit your situation.'
      },
      {
        question: 'Are you a registered investment advisor?',
        answer: 'Yes, we are registered and licensed to provide investment advisory services. We maintain all required licenses and registrations.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.FINANCE,
    servicePlans: [
      {
        name: 'Financial Consultation',
        description: 'Initial financial planning consultation',
        price: { amount: 300, currency: 'USD' }
      },
      {
        name: 'Wealth Management',
        description: 'Comprehensive wealth management services',
        price: { amount: 0, currency: 'USD' }
      }
    ],
    introduction: 'Hi! 👋 This is {assistantName} from {companyName}. We help you achieve your financial goals with expert advice and personalized strategies. How can we assist you today?'
  },
  [INDUSTRIES.HOSPITALITY]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our hospitality establishment. How can we make your stay or visit memorable?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Reservation',
            question: 'Would you like to make a reservation?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Amenities',
            question: 'Would you like information about our amenities and services?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Special Requests',
            question: 'Do you have any special requests or requirements?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What are your check-in and check-out times?',
        answer: 'Check-in time is 3:00 PM and check-out time is 11:00 AM. Early check-in and late check-out may be available upon request, subject to availability.'
      },
      {
        question: 'Do you offer parking?',
        answer: 'Yes, we offer parking facilities. Valet parking and self-parking options are available. Please let us know your preference when making a reservation.'
      },
      {
        question: 'What amenities do you have?',
        answer: 'We offer a range of amenities including Wi-Fi, fitness center, pool, spa services, restaurant, room service, and business center facilities.'
      },
      {
        question: 'Do you accommodate special dietary requirements?',
        answer: 'Yes, we can accommodate various dietary requirements including vegetarian, vegan, gluten-free, and other special diets. Please inform us in advance.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.HOSPITALITY,
    servicePlans: [
      {
        name: 'Standard Room',
        description: 'Comfortable standard accommodation',
        price: { amount: 150, currency: 'USD' }
      },
      {
        name: 'Deluxe Package',
        description: 'Premium accommodation with additional amenities',
        price: { amount: 250, currency: 'USD' }
      }
    ],
    introduction: 'Hello! 👋 This is {assistantName} from {companyName}. We\'re committed to giving you exceptional service and a memorable experience. How can we help you today?'
  },
  [INDUSTRIES.RETAIL]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our store. How can I help you find what you\'re looking for?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Product Search',
            question: 'What product are you looking for?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Store Hours',
            question: 'What are your store hours?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Returns & Exchanges',
            question: 'Do you have questions about returns or exchanges?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What are your store hours?',
        answer: 'We are open Monday through Saturday from 9:00 AM to 8:00 PM, and Sunday from 10:00 AM to 6:00 PM. Hours may vary during holidays.'
      },
      {
        question: 'Do you offer online shopping?',
        answer: 'Yes, we offer online shopping with home delivery and in-store pickup options. Visit our website to browse our full catalog.'
      },
      {
        question: 'What is your return policy?',
        answer: 'We accept returns within 30 days of purchase with a valid receipt. Items must be in original condition with tags attached. Some items may be subject to restocking fees.'
      },
      {
        question: 'Do you offer gift cards?',
        answer: 'Yes, we offer gift cards in various denominations. They can be purchased in-store or online and never expire.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.RETAIL,
    servicePlans: [
      {
        name: 'Standard Service',
        description: 'Regular retail service',
        price: { amount: 0, currency: 'USD' }
      },
      {
        name: 'Premium Membership',
        description: 'Membership with exclusive discounts and benefits',
        price: { amount: 50, currency: 'USD' }
      }
    ],
    introduction: 'Hey there! 👋 This is {assistantName} from {companyName}. We offer quality products and excellent customer service. What can we help you find today?'
  },
  [INDUSTRIES.TECHNOLOGY]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our technology company. How can we help you with your technology needs?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Services',
            question: 'What technology services are you interested in?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Support',
            question: 'Do you need technical support?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Products',
            question: 'Are you looking for software or hardware products?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What technology services do you offer?',
        answer: 'We offer a comprehensive range of technology services including software development, cloud solutions, IT consulting, system integration, cybersecurity, and technical support.'
      },
      {
        question: 'Do you provide 24/7 support?',
        answer: 'Yes, we offer 24/7 technical support for our clients. Our support team is available around the clock to assist with any technical issues.'
      },
      {
        question: 'What industries do you serve?',
        answer: 'We serve businesses across various industries including healthcare, finance, retail, manufacturing, and education. Our solutions are tailored to meet industry-specific needs.'
      },
      {
        question: 'Do you offer custom software development?',
        answer: 'Yes, we specialize in custom software development. We work closely with clients to understand their requirements and deliver tailored solutions.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.TECHNOLOGY,
    servicePlans: [
      {
        name: 'Basic Support',
        description: 'Standard technical support package',
        price: { amount: 100, currency: 'USD' }
      },
      {
        name: 'Enterprise Solution',
        description: 'Comprehensive technology solution for enterprise clients',
        price: { amount: 5000, currency: 'USD' }
      }
    ],
    introduction: 'Hi! 👋 This is {assistantName} from {companyName}. We provide innovative technology solutions to help your business succeed. How can we assist you today?'
  },
  [INDUSTRIES.OTHER]: {
    workflows: [
      {
        title: 'Welcome',
        question: 'Hello! Welcome to our business. How can we help you today?',
        questionTypeId: 1,
        isRoot: true,
        order: 0,
        children: [
          {
            title: 'Services',
            question: 'What services are you interested in?',
            questionTypeId: 1,
            isRoot: false,
            order: 1
          },
          {
            title: 'Contact',
            question: 'Would you like to speak with someone?',
            questionTypeId: 1,
            isRoot: false,
            order: 2
          },
          {
            title: 'Information',
            question: 'Do you need more information about our business?',
            questionTypeId: 1,
            isRoot: false,
            order: 3
          }
        ]
      }
    ],
    faqs: [
      {
        question: 'What are your business hours?',
        answer: 'Our business hours are Monday through Friday from 9:00 AM to 5:00 PM. We are closed on weekends and major holidays.'
      },
      {
        question: 'How can I contact you?',
        answer: 'You can contact us by phone, email, or through our website. We typically respond within 24 hours during business days.'
      },
      {
        question: 'What services do you offer?',
        answer: 'We offer a variety of services tailored to meet your needs. Please contact us to discuss how we can help you.'
      }
    ],
    leadTypes: INDUSTRY_LEAD_TYPES.OTHER,
    servicePlans: [
      {
        name: 'Basic Service',
        description: 'Standard service package',
        price: { amount: 0, currency: 'USD' }
      }
    ],
    introduction: 'Hello! 👋 This is {assistantName} from {companyName}. We\'re here to help you with whatever you need. How can we assist you today?'
  }
};

// Initialize seed data for all industries
const initializeSeedData = async () => {
  try {
    await connectDB();

    console.log('Initializing seed data for all industries...');

    for (const [industry, seedData] of Object.entries(seedDataTemplates)) {
      try {
        const existing = await IndustrySeed.findOne({ industry });
        if (existing) {
          console.log(`Seed data for ${industry} already exists. Updating...`);
          await IndustrySeed.replaceOne(
            { industry },
            {
              industry,
              ...seedData,
              isActive: true,
              updatedAt: new Date(),
              createdAt: existing.createdAt
            }
          );
          console.log(`✓ Updated seed data for ${industry}`);
        } else {
          const industrySeed = new IndustrySeed({
            industry,
            ...seedData,
            isActive: true
          });
          await industrySeed.save();
          console.log(`✓ Created seed data for ${industry}`);
        }
      } catch (error) {
        console.error(`Error initializing seed data for ${industry}:`, error.message);
      }
    }

    // Verify all industries have seed data
    const allIndustries = Object.values(INDUSTRIES);
    const industriesWithTemplates = Object.keys(seedDataTemplates);
    const missingIndustries = allIndustries.filter(industry => !industriesWithTemplates.includes(industry));

    if (missingIndustries.length > 0) {
      console.log(`\n⚠ Warning: Missing seed data templates for: ${missingIndustries.join(', ')}`);
      console.log('Creating minimal default templates for missing industries...');
      
      for (const industry of missingIndustries) {
        try {
          const existing = await IndustrySeed.findOne({ industry });
          if (!existing) {
            const defaultSeed = {
              industry,
              workflows: [
                {
                  title: 'Welcome',
                  question: `Hello! Welcome to our ${industry} business. How can I help you today?`,
                  questionTypeId: 1,
                  isRoot: true,
                  order: 0
                }
              ],
              faqs: [
                {
                  question: 'What are your business hours?',
                  answer: 'Please contact us for our current business hours.'
                }
              ],
              leadTypes: INDUSTRY_LEAD_TYPES.OTHER,
              servicePlans: [],
              introduction: `Hi! 👋 This is {assistantName} from {companyName}. How can we assist you today?`,
              isActive: true
            };

            const industrySeed = new IndustrySeed(defaultSeed);
            await industrySeed.save();
            console.log(`✓ Created default seed data for ${industry}`);
          }
        } catch (error) {
          console.error(`Error creating default seed data for ${industry}:`, error.message);
        }
      }
    } else {
      console.log('\n✓ All industries have seed data templates!');
    }

    console.log('\n✓ Seed data initialization completed!');
    process.exit(0);

  } catch (error) {
    console.error('Error initializing seed data:', error);
    process.exit(1);
  }
};

// Run the initialization
if (require.main === module) {
  initializeSeedData();
}

module.exports = { initializeSeedData, seedDataTemplates };
