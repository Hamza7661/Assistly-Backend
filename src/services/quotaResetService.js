const { AppPlan } = require('../models/AppPlan');

const CHANNELS = ['web', 'whatsapp', 'facebook', 'instagram', 'voice'];

function firstMomentNextMonthUTC(from) {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(1);
  d.setUTCHours(0, 1, 0, 0);
  return d;
}

async function resetDueQuotas(now = new Date()) {
  const plans = await AppPlan.find({
    resetCycle: { $ne: 'never' },
    paymentCleared: true,
  });

  let updatedPlans = 0;
  for (const plan of plans) {
    const $set = { updatedAt: now };
    let touched = false;

    for (const ch of CHANNELS) {
      const q = plan.quotas?.[ch];
      if (!q) continue;
      const resetAt = q.resetAt ? new Date(q.resetAt) : null;
      if (!resetAt || resetAt > now) continue;

      $set[`quotas.${ch}.used`] = 0;
      $set[`quotas.${ch}.periodStart`] = now;
      $set[`quotas.${ch}.lastResetAt`] = now;
      $set[`quotas.${ch}.resetAt`] = firstMomentNextMonthUTC(now);
      touched = true;
    }

    if (touched) {
      await AppPlan.updateOne({ _id: plan._id }, { $set });
      updatedPlans += 1;
    }
  }

  return { updatedPlans };
}

module.exports = { resetDueQuotas, firstMomentNextMonthUTC, CHANNELS };
