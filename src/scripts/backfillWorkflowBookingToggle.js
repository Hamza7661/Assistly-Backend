/**
 * Backfill workflow booking toggle for legacy records.
 *
 * Sets askForBookingAtEnd=true only where the field is missing.
 *
 * Usage:
 *   node src/scripts/backfillWorkflowBookingToggle.js
 *   node src/scripts/backfillWorkflowBookingToggle.js --dry-run
 */

const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { ChatbotWorkflow } = require('../models/ChatbotWorkflow');

async function runBackfill({ dryRun = false } = {}) {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured.');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const filter = { askForBookingAtEnd: { $exists: false } };
  const missingCount = await ChatbotWorkflow.countDocuments(filter);
  console.log(`[backfill] Workflows missing askForBookingAtEnd: ${missingCount}`);

  if (missingCount === 0) {
    console.log('[backfill] Nothing to update.');
    return;
  }

  if (dryRun) {
    console.log('[backfill] Dry run complete. No records were updated.');
    return;
  }

  const result = await ChatbotWorkflow.updateMany(filter, {
    $set: { askForBookingAtEnd: true }
  });

  console.log(`[backfill] Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
  console.log('[backfill] Completed successfully.');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  try {
    await runBackfill({ dryRun });
  } catch (error) {
    console.error('[backfill] Failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

main();
