const mongoose = require('mongoose');

const ComplaintSchema = new mongoose.Schema(
  {
    siteId: { type: String, required: true, index: true },
    site: { type: String, required: true },
    cat: {
      type: String,
      enum: ['Equipment', 'Data', 'Calibration', 'Connectivity', 'Service', 'Other'],
      default: 'Other',
    },
    msg: { type: String, required: true },
    status: {
      type: String,
      enum: ['open', 'progress', 'resolved'],
      default: 'open',
      index: true,
    },
    by: { type: String, default: '—' },
    time: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

module.exports = mongoose.model('Complaint', ComplaintSchema);