const mongoose = require('mongoose');

const HistoryItemSchema = new mongoose.Schema(
  {
    package: String,
    months: Number,
    price: Number,
    at: { type: Date, default: Date.now },
    till: Date,
    by: String,
  },
  { _id: false }
);

const ServiceContractSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true, index: true },
    key: { type: String, required: true },        // 'DTC' or 'AMC|Gas Analyser'
    start: { type: Date, default: Date.now },
    expiry: { type: Date, default: null, index: true },
    package: { type: String, default: null },     // tier id e.g. 'amc-y'
    suspended: { type: Boolean, default: false },
    history: { type: [HistoryItemSchema], default: [] },
  },
  { timestamps: true }
);

ServiceContractSchema.index({ siteId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('ServiceContract', ServiceContractSchema);