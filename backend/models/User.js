const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    role: {
      type: String,
      enum: ['admin', 'engineer', 'sales', 'industry'],
      required: true,
      index: true,
    },
    login: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    mobile: { type: String, default: '' },
    email: { type: String, default: '' },
    siteId: { type: String, default: null }, // for industry role
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);