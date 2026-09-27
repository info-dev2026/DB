/* ============================================================
   Parameter registry — mirrors the frontend's utils/cpcb.js
   Used by the CPCB grading engine on the server side.
   ============================================================ */

module.exports = {
  /* ---------- Emission / stack parameters ---------- */
  PM:          { pid: 'P-PM',   unit: 'mg/Nm³', limit: 50,  dev: 60,  type: 'stack', label: 'Particulate Matter' },
  SO2:         { pid: 'P-SO2',  unit: 'mg/Nm³', limit: 200, dev: 25,  type: 'stack', label: 'Sulphur Dioxide' },
  NOx:         { pid: 'P-NOX',  unit: 'mg/Nm³', limit: 300, dev: 25,  type: 'stack', label: 'Oxides of Nitrogen' },
  CO:          { pid: 'P-CO',   unit: 'mg/Nm³', limit: 100, dev: 25,  type: 'stack', label: 'Carbon Monoxide' },
  Flow:        { pid: 'P-FLOW', unit: 'm³/s',   limit: 5,   dev: 50,  type: 'stack', label: 'Stack Flow' },
  Temperature: { pid: 'P-TEMP', unit: '°C',     limit: 180, dev: 40,  type: 'stack', label: 'Flue Temperature' },
  Pressure:    { pid: 'P-PRES', unit: 'mmH₂O',  limit: 120, dev: 40,  type: 'stack', label: 'Static Pressure' },

  /* ---------- Effluent / ETP parameters ---------- */
  pH:          { pid: 'P-PH',   unit: '',       limit: 8.5, min: 6.5, dev: 0,   type: 'etp', ph: true, label: 'pH' },
  BOD:         { pid: 'P-BOD',  unit: 'mg/L',   limit: 30,  dev: 100, type: 'etp', label: 'Biochemical Oxygen Demand' },
  COD:         { pid: 'P-COD',  unit: 'mg/L',   limit: 250, dev: 100, type: 'etp', label: 'Chemical Oxygen Demand' },
  TSS:         { pid: 'P-TSS',  unit: 'mg/L',   limit: 100, dev: 100, type: 'etp', label: 'Total Suspended Solids' },
  TOC:         { pid: 'P-TOC',  unit: 'mg/L',   limit: 100, dev: 100, type: 'etp', label: 'Total Organic Carbon' },
};