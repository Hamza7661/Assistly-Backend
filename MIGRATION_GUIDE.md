# WhatsApp Integration Migration Guide
## From User-Based to App-Based Phone Numbers

This guide explains how to migrate from user-based Twilio phone numbers to app-based phone numbers, ensuring each app has its own Integration settings.

---

## Problem Summary

**Before Migration:**
- ✅ Twilio phone attached to **User**
- ✅ Integration attached to **User**
- ✅ WhatsApp works, but all apps share same settings

**After Incomplete Migration:**
- ✅ Twilio phone moved to **App** (different for each app)
- ❌ Integration still attached to **User** (shared by all apps)
- ❌ WhatsApp webhook can't find Integration → No greeting/conversation!

**After Complete Migration:**
- ✅ Twilio phone attached to **App** (different for each app)
- ✅ Integration attached to **App** (different for each app)
- ✅ WhatsApp works, and each app has its own settings!

---

## Migration Steps

### Step 1: Check Current State

First, verify your current setup:

```bash
cd D:\Assistly\Assistly-Backend

# Test if webhook context lookup works
node src/scripts/testWhatsAppWebhook.js +447400485383
```

Expected output:
- ✅ App found (Biryaniwaala)
- ⚠️ Integration found (user-scoped) ← This is the problem!
- ✅ Service Plans found
- ✅ FAQs found

### Step 2: Migrate Integration to App

Run the migration script to create app-scoped Integrations:

```bash
# Migrate for all apps
node src/scripts/migrateIntegrationToApp.js your-email@example.com

# Or for specific app only
node src/scripts/migrateIntegrationToApp.js your-email@example.com Biryaniwaala
```

What this does:
- ✅ Creates new Integration for each app
- ✅ Copies settings from user Integration (greeting, colors, lead types, etc.)
- ✅ Each app now has its own Integration (can be customized independently)

### Step 3: Verify Migration

Test again to confirm:

```bash
node src/scripts/testWhatsAppWebhook.js +447400485383
```

Expected output:
- ✅ App found (Biryaniwaala)
- ✅ Integration found (**app-scoped**) ← Fixed!
- ✅ Service Plans found
- ✅ FAQs found

### Step 4: Restart Services

```bash
# Terminal 1: Restart Backend
cd D:\Assistly\Assistly-Backend
# Stop with Ctrl+C, then:
npm start

# Terminal 2: Restart AI Service
cd D:\Assistly\Assistly-AI
# Stop with Ctrl+C, then restart with your usual command
```

### Step 5: Test WhatsApp

Send a message to **+447400485383** on WhatsApp. You should receive:
- ✅ Greeting message
- ✅ Lead type options
- ✅ Full conversation flow

---

## Understanding the Fallback Logic

### Current Code (Temporary)

```javascript
// Look for Integration by appId first, then fall back to userId
const integrationPromise = Integration.findOne({ owner: appId })
  .exec()
  .then(integration => {
    if (integration) return integration;  // ✅ Found app Integration
    return Integration.findOne({ owner: userId }).exec();  // ⚠️ Fallback to user
  });
```

### How It Works

1. **Biryaniwaala app** receives WhatsApp message
2. Webhook looks up app by phone number: ✅ Found
3. Try to find Integration with `owner: BiryaniwaalaAppId`:
   - **Before migration**: Not found → Falls back to user Integration
   - **After migration**: Found! → Uses Biryaniwaala-specific settings

4. **Future app** (if you create another) receives WhatsApp message
5. Webhook looks up app by phone number: ✅ Found
6. Try to find Integration with `owner: FutureAppId`:
   - **After migration**: Found! → Uses FutureApp-specific settings
   - Each app is **independent** with its own greeting, colors, etc.

### Why Multi-App Works

The fallback only triggers **if an app doesn't have its own Integration yet**. Once you run the migration:

- ✅ Biryaniwaala has its own Integration → uses it
- ✅ Future app has its own Integration → uses it
- ✅ Each app is **distinguished** by its own settings
- ✅ No conflict between apps!

---

## Optional: Remove Fallback (Clean Up)

Once **all your apps** have their own Integrations, you can remove the fallback code for cleaner logic:

### In `src/routes/user.js`, replace both occurrences:

**FROM:**
```javascript
// TEMPORARY: Look for Integration by appId first, then fall back to userId during migration
const integrationPromise = Integration.findOne({ owner: appId })
  .exec()
  .then(integration => {
    if (integration) return integration;
    return Integration.findOne({ owner: userId }).exec();
  });
```

**TO:**
```javascript
// Each app has its own Integration (app-scoped)
const integrationPromise = Integration.findOne({ owner: appId }).exec();
```

This makes the code simpler and enforces that **every app must have its own Integration**.

---

## Customizing Individual Apps

After migration, you can customize each app's Integration independently:

```javascript
// In your frontend or database, update Integration for specific app
// Example: Update Biryaniwaala app Integration
db.integrations.updateOne(
  { owner: ObjectId("BiryaniwaalaAppId") },
  { 
    $set: { 
      assistantName: "Biryani Bot",
      greeting: "Welcome to Biryaniwaala! How can I serve you today?",
      primaryColor: "#FF6B35"
    } 
  }
);

// Update Future app Integration differently
db.integrations.updateOne(
  { owner: ObjectId("FutureAppId") },
  { 
    $set: { 
      assistantName: "Future Assistant",
      greeting: "Hi! How can Future App help you?",
      primaryColor: "#3B82F6"
    } 
  }
);
```

Each app will now have:
- ✅ Different greeting message
- ✅ Different assistant name
- ✅ Different colors
- ✅ Different lead types (if needed)

---

## Troubleshooting

### Issue: "No Integration found"

**Cause**: Migration script not run yet

**Solution**:
```bash
node src/scripts/migrateIntegrationToApp.js your-email@example.com
```

### Issue: "App already has Integration, skipping"

**Cause**: Integration already exists for that app (good!)

**Solution**: No action needed. Your app is already set up correctly.

### Issue: WhatsApp still not working

**Checklist**:
1. ✅ Did you run the migration script?
2. ✅ Did you restart the backend?
3. ✅ Did you restart the AI service?
4. ✅ Is the Twilio webhook configured correctly? (`https://assistly.upzilo.com/webhook/whatsapp`)
5. ✅ Is the phone number attached to the correct app? (Check in frontend: My Apps)

### Issue: MongoDB connection error

**Cause**: Network/VPN issue or MongoDB credentials

**Solution**: Check your `.env` file has correct `MONGODB_URI`

---

## Summary

### What You Need to Do

1. ✅ Run migration script: `node src/scripts/migrateIntegrationToApp.js <email>`
2. ✅ Restart backend and AI services
3. ✅ Test WhatsApp by sending a message
4. ✅ (Optional) Remove fallback code after confirming everything works

### What This Achieves

- ✅ Each app has its own Integration settings
- ✅ WhatsApp works with proper greeting and conversation
- ✅ Multi-app setup is properly supported
- ✅ Each app can be customized independently

---

## Next Steps

After migration:
1. **Test all your apps** (if you have multiple)
2. **Customize each app's Integration** through your admin panel or directly in database
3. **Remove fallback code** from `user.js` (optional, for cleaner code)
4. **Document your app-specific settings** for future reference
