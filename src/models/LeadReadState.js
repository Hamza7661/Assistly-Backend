const mongoose = require('mongoose');

const leadReadStateSchema = new mongoose.Schema({
  appId: { type: mongoose.Schema.Types.ObjectId, ref: 'App', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  readAt: { type: Date, default: Date.now, required: true },
}, { timestamps: true });

leadReadStateSchema.index({ appId: 1, userId: 1, leadId: 1 }, { unique: true });

const LeadReadState = mongoose.model('LeadReadState', leadReadStateSchema);

module.exports = { LeadReadState };
