const mongoose = require('mongoose');

/* ---- Parameter subdocument ---- */
const ParamSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    pid: { type: String, required: true },        // ESK-4417-PM
    unit: { type: String, default: '' },
    limit: { type: Number, required: true },
    min: { type: Number, default: null },         // for pH only
    value: { type: Number, default: 0 },
    phVal: { type: Number, default: null },
    signal: { type: String, default: 'green' },   // green/yellow/orange/red/purple/grey
    yToday: { type: Number, default: 0 },
    y30: { type: Number, default: 0 },
    y30conn: { type: Number, default: 0 },
    connHrs: { type: Number, default: 0 },
    connFailHrsToday: { type: Number, default: 0 },
    stableHrs: { type: Number, default: 0 },
    excStreak: { type: Number, default: 0 },
    redCount30: { type: Number, default: 0 },
    history: { type: [Number], default: [] },     // last 24 values
  },
  { _id: false }
);

/* ---- Site document ---- */
const SiteSchema = new mongoose.Schema(
  {
    id: { type: String, unique: true, required: true, index: true }, // ESK-4417
    name: { type: String, required: true },
    sector: { type: String, default: '—' },
    loc: { type: String, default: '—' },
    lat: { type: Number, default: 28.6 },
    lng: { type: Number, default: 77.2 },
    spcb: { type: String, default: 'HSPCB' },
    category: { type: String, default: '17-Category' },
    stacks: { type: Number, default: 1 },
    etp: { type: Number, default: 1 },
    contact: { type: String, default: '—' },
    phone: { type: String, default: '—' },
    email: { type: String, default: '' },
    ganga: { type: Boolean, default: false },

    params: { type: [ParamSchema], default: [] },

    connectivity: { type: String, default: 'live' }, // live / delay / grey
    enabled: { type: Boolean, default: true },
    running: { type: Boolean, default: true },
    passcode: { type: String, required: true },

    lastData: { type: String, default: '—' },
    lastSeenAt: { type: Date, default: null },       // used for offline detection
    signal: { type: String, default: 'green' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Site', SiteSchema);