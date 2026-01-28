# Industry-Based Seed Data System

This system automatically populates new apps with industry-specific default content including workflows, FAQs, lead types, and service plans.

## Overview

When a new app is created, the system automatically copies industry-specific seed data to that app. The seed data includes:

1. **Conversation Flows (Workflows)**: Default chatbot conversation flows tailored to the industry
2. **FAQs**: Frequently asked questions and answers relevant to the industry
3. **Lead Types**: Default lead type configurations
4. **Service Plans**: Treatment/service plans specific to the industry
5. **Introduction Message**: Default greeting message

## How It Works

1. **Seed Data Storage**: Industry templates are stored in the `IndustrySeed` collection
2. **App Creation**: When a new app is created, the `SeedDataService` automatically copies the relevant seed data
3. **Independent Copies**: Each app gets its own copy of the seed data, which can be modified without affecting the original templates
4. **Template Preservation**: The original seed data templates remain untouched and can be updated independently

## Initialization

Before creating apps, you need to initialize the seed data for all industries:

```bash
# From the backend directory
node src/scripts/initializeSeedData.js
```

This script will:
- Create seed data templates for all supported industries
- Use detailed templates for major industries (Dental, Healthcare, Real Estate, Legal, Food, Automotive, Beauty, Fitness)
- Create minimal default templates for other industries

## Supported Industries

The system includes detailed seed data for:
- **Dental**: Dental clinic workflows, FAQs, and service plans
- **Healthcare**: Medical facility workflows and FAQs
- **Real Estate**: Property-related workflows and FAQs
- **Legal**: Law firm workflows and FAQs
- **Food**: Restaurant workflows and FAQs
- **Automotive**: Auto service workflows and FAQs
- **Beauty**: Beauty salon workflows and FAQs
- **Fitness**: Fitness center workflows and FAQs

Other industries receive a basic default template that can be customized.

## Customizing Seed Data

### Adding New Industry Templates

Edit `src/scripts/initializeSeedData.js` and add your industry template to the `seedDataTemplates` object:

```javascript
[INDUSTRIES.YOUR_INDUSTRY]: {
  workflows: [/* workflow templates */],
  faqs: [/* FAQ templates */],
  leadTypes: [/* lead type configurations */],
  servicePlans: [/* service plan templates */],
  introduction: 'Your welcome message'
}
```

Then run the initialization script again.

### Updating Existing Templates

1. Edit `src/scripts/initializeSeedData.js`
2. Update the template for your industry
3. Run the initialization script (it will update existing templates)

## Technical Details

### Models

- **IndustrySeed**: Stores industry templates (one document per industry)
- **ChatbotWorkflow**: Stores app-specific workflows (copied from seed data)
- **Questionnaire**: Stores app-specific FAQs and service plans (copied from seed data)

### Service

- **SeedDataService**: Handles copying seed data to new apps
  - `copySeedDataToApp(appId, industry)`: Main method to copy seed data
  - `copyWorkflows()`: Recursively copies workflow trees
  - `copyFAQs()`: Copies FAQ entries
  - `copyServicePlans()`: Copies service plans as treatment plans

### Workflow Structure

Workflows support hierarchical structures:
- **Root workflows**: Top-level conversation starters
- **Child workflows**: Follow-up questions linked to parent workflows
- The system maintains parent-child relationships when copying

## Usage

No additional action is required when creating apps. The seed data is automatically copied when:

1. A new app is created via the `/api/apps` POST endpoint
2. The app's industry is specified
3. The system finds matching seed data for that industry

If seed data doesn't exist for an industry, the app is still created but without default content.

## Notes

- Seed data templates are read-only and never modified by app operations
- Each app gets independent copies that can be edited, deleted, or extended
- The original templates serve as a starting point and can be updated to improve defaults for future apps
- Seed data copying happens asynchronously and won't block app creation if it fails
