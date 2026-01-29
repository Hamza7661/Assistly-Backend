# Biryani Waala Conversation Flow

## Overview
Graceful, intent-based lead types that naturally guide users to relevant services.
**Rule:** Every lead type shows at least 2 service options for natural choice.

## Flow Structure

```
Greeting → Lead Type (Intent) → 2-4 Service Plans → 5 Conversation Questions → Lead Generation
```

---

## Lead Types (User Intent) - Graceful Filtering

### 1. **"I want to place an order for delivery or pickup"**
- **Intent:** Order food
- **Shows:** 3 ordering methods
  - Delivery service
  - Pickup service
  - Dine-in experience

### 2. **"I need catering services for an event"**
- **Intent:** Event catering
- **Shows:** 2 services (events + dietary)
  - Catering package
  - Allergy-free & dietary options

### 3. **"I would like to make a dining reservation"**
- **Intent:** Dine in
- **Shows:** 2 services (dining + dietary)
  - Dine-in experience
  - Allergy-free & dietary options

### 4. **"I want to see your menu and special items"**
- **Intent:** Browse menu
- **Shows:** 4 services (all ordering options)
  - Delivery service
  - Pickup service
  - Dine-in experience
  - Catering package

### 5. **"I have allergies or dietary requirements to discuss"**
- **Intent:** Special dietary needs
- **Shows:** 3 services (safe food options)
  - Allergy-free & dietary options
  - Delivery service
  - Pickup service

---

## Service Plans → Conversation Flows (5 Questions Each)

Each service has 5 comprehensive questions for lead capture:

### **Dine-in experience**
1. What date would you like to dine with us?
2. What time would you prefer?
3. How many people will be dining?
4. Is this for a special occasion?
5. Any dietary requirements or allergies?

### **Delivery service**
1. What is your delivery postcode or area?
2. What is your full delivery address?
3. What would you like to order?
4. When would you like delivery?
5. Any special instructions?

### **Pickup service**
1. What would you like to order?
2. What size? (Regular, Economy, 1KG)
3. What time to collect?
4. Any extras? (Naan, Raita, etc.)
5. Any special requests?

### **Catering package**
1. What type of event?
2. Event date?
3. How many guests?
4. Menu preferences?
5. Dietary restrictions or allergies?

### **Allergy-free & dietary options**
1. What food allergies do you have?
2. How severe is the allergy?
3. Any dietary preferences?
4. Which dishes interest you?
5. Any other dietary concerns?

---

## Example Flows

### Example 1: Browse → Delivery
```
Bot: What would you like to do today?
     [I want to see your services]
     [I need information...]
     [I want to place an order]
     [I need catering...]
     [I have allergies...]

User: [I want to see your services]

Bot: Which service are you interested in?
     [Dine-in experience]
     [Delivery service]
     [Pickup service]
     [Catering package]
     [Allergy-free & dietary options]

User: [Delivery service]

Bot: What's your delivery postcode or area?

User: SW17 7AA

Bot: What's your name?
... (continues to lead generation)
```

### Example 2: Order → Pickup
```
Bot: What would you like to do today?

User: [I want to place an order]

Bot: Which service are you interested in?
     [Delivery service]
     [Pickup service]
     [Dine-in experience]

User: [Pickup service]

Bot: Roughly what time would you like to collect?

User: 6pm

Bot: What's your name?
... (continues to lead generation)
```

### Example 3: Allergy → Direct to service
```
Bot: What would you like to do today?

User: [I have allergies or dietary requirements]

Bot: Which service are you interested in?
     [Allergy-free & dietary options]

User: [Allergy-free & dietary options]

Bot: Do you or any guests have food allergies or dietary restrictions?

User: Yes, nut allergy

Bot: Please describe them (nut-free, gluten-free, halal, vegetarian, no dairy)

User: Severe nut allergy, need everything nut-free

Bot: What's your name?
... (continues to lead generation)
```

---

## Technical Implementation

- **Backend:** Lead types have optional `relevantServicePlans` array
- **AI:** Filters services based on selected lead type
- **Sequential Flow:** Each step naturally leads to the next
- **Realistic:** Generic intents show all services, specific intents narrow down

---

## Running the Setup

```bash
cd D:\Assistly\Assistly-Backend
node src/scripts/setupBiryaniWaalaFlow.js
```

This will:
1. Find the app under libra_dn@hotmail.com
2. Set 5 intent-based lead types with service mappings
3. Create/update 5 service plans
4. Create/update conversation flows for each service
5. Link flows to services
6. Add allergy-related FAQs

After running, restart the backend or wait for cache to expire (5 minutes).
