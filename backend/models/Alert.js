const mongoose = require('mongoose');

const AlertSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true, index: true },
    site: { type: String, required: true },
    param: { type: String, required: true },      // 'PM', 'DEVICE', etc.
    level: {
      type: String,
      enum: ['green', 'yellow', 'orange', 'red', 'purple', 'grey', 'delay'],
      required: true,
    },
    reason: { type: String, default: '' },
    acknowledged: { type: Boolean, default: false, index: true },
    ackBy: { type: String, default: null },
    ackAt: { type: Date, default: null },
    emailed: { type: Boolean, default: false },
    ts: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

AlertSchema.index({ siteId: 1, ts: -1 });

module.exports = mongoose.model('Alert', AlertSchema);