const mongoose = require('mongoose');

const ReadingSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true, index: true },
    pid: { type: String, index: true },           // ESK-4417-PM
    param: { type: String, required: true },      // PM / SO2 / pH / ...
    value: { type: Number, required: true },
    ts: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

/* Compound index for fast time-range queries per site */
ReadingSchema.index({ siteId: 1, ts: -1 });

module.exports = mongoose.model('Reading', ReadingSchema);