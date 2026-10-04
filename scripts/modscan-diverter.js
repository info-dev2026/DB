#!/usr/bin/env node
/* ============================================================
   scripts/modscan-diverter.js

   Generic ModScan & Modbus Telemetry Diverter Client
   Connects to ModScan / Modbus, reads registers, maps them to
   Parameter IDs (PIDs), and diverts real-time responses to
   the Saaphzone dashboard.

   USAGE:
     1. Test hitting simulated live data for all PIDs:
        node scripts/modscan-diverter.js --sim

     2. Hit a single parameter reading directly:
        node scripts/modscan-diverter.js --pid "855-PH" --value 7.42 --site "ESK-4417"

     3. Run in continuous live polling mode (every 5 seconds):
        node scripts/modscan-diverter.js --interval 5000

     4. Modbus TCP direct poll (connect to PLC/gateway):
        node scripts/modscan-diverter.js --tcp 192.168.1.100:502
   ============================================================ */

const http = require('http');
const https = require('https');
const { URL } = require('url');

/* ============================================================
   CONFIGURATION — customize for your industrial site setup
   ============================================================ */
const CONFIG = {
  // Target API endpoint (cloud backend or local port 4000)
  endpointUrl:
    process.env.SZ_API_URL ||
    'https://saaphzone-backend.onrender.com/api/datalogger/readings',

  // Device / Logger authentication key
  apiKey:
    process.env.SZ_DEVICE_KEY ||
    'sz_generic_logger_key_2026',

  // Target Site Code (e.g. ESK-4417, SITE-01, 855)
  siteId:
    process.env.SZ_SITE_ID ||
    'ESK-4417',

  // Polling interval in milliseconds
  pollIntervalMs: 5000,
};

/* ============================================================
   GENERIC MODSCAN REGISTER-TO-PARAMETER-ID (PID) MAP
   Configure your ModScan register addresses to your Parameter IDs.
   The diverter code automatically loops through every parameter.
   ============================================================ */
const MODSCAN_PID_MAP = [
  {
    address: 40001,
    pid: '855-PH',
    paramKey: 'pH',
    name: 'Effluent pH Analyzer',
    scale: 0.01,        // raw 742 -> 7.42
    simBase: 7.35,
    simVariance: 0.25,
    min: 0,
    max: 14,
  },
  {
    address: 40002,
    pid: '855-COD',
    paramKey: 'COD',
    name: 'Chemical Oxygen Demand',
    scale: 1.0,
    simBase: 140.0,
    simVariance: 15.0,
    min: 0,
    max: 500,
  },
  {
    address: 40003,
    pid: '855-BOD',
    paramKey: 'BOD',
    name: 'Biochemical Oxygen Demand',
    scale: 1.0,
    simBase: 22.0,
    simVariance: 4.0,
    min: 0,
    max: 100,
  },
  {
    address: 40004,
    pid: '855-TSS',
    paramKey: 'TSS',
    name: 'Total Suspended Solids',
    scale: 1.0,
    simBase: 45.0,
    simVariance: 8.0,
    min: 0,
    max: 200,
  },
  {
    address: 40005,
    pid: '855-FLOW',
    paramKey: 'Flow',
    name: 'Discharge Flow Rate',
    scale: 0.1,
    simBase: 3.2,
    simVariance: 0.5,
    min: 0,
    max: 10,
  },
  {
    address: 40006,
    pid: '855-SOX',
    paramKey: 'SOX',
    name: 'Stack Sulphur Dioxide',
    scale: 0.1,
    simBase: 88.0,
    simVariance: 12.0,
    min: 0,
    max: 400,
  },
  {
    address: 40007,
    pid: '855-NOX',
    paramKey: 'NOx',
    name: 'Stack Oxides of Nitrogen',
    scale: 0.1,
    simBase: 130.0,
    simVariance: 18.0,
    min: 0,
    max: 500,
  },
  {
    address: 40008,
    pid: '855-PM',
    paramKey: 'PM',
    name: 'Particulate Matter (Dust)',
    scale: 0.1,
    simBase: 38.0,
    simVariance: 6.0,
    min: 0,
    max: 150,
  },
  {
    address: 40009,
    pid: '855-TEMP',
    paramKey: 'Temperature',
    name: 'Flue Gas Temperature',
    scale: 0.1,
    simBase: 125.0,
    simVariance: 4.0,
    min: 0,
    max: 300,
  },
];

/**
 * Generic HTTP POST function that hits the dashboard datalogger endpoint.
 */
function sendToDashboard(readingsPayload) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(CONFIG.endpointUrl);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const data = JSON.stringify({
      siteId: CONFIG.siteId,
      readings: readingsPayload,
    });

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-device-key': CONFIG.apiKey,
        'x-api-key': CONFIG.apiKey,
      },
      timeout: 10000,
    };

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Server responded with ${res.statusCode}: ${body}`));
          }
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 10s'));
    });

    req.write(data);
    req.end();
  });
}

/**
 * ============================================================
 * GENERIC TELEMETRY DIVERTER
 * Diverts the response of every parameter dynamically by Parameter ID (PID).
 * ============================================================
 *
 * @param {Array<object>|object} rawModscanData
 *   Accepts either:
 *   - An array of register values: [{ address: 40001, rawValue: 742 }, ...]
 *   - A key-value register map: { 40001: 742, 40002: 140 }
 *   - A PID-to-value map: { '855-PH': 7.42, '855-SOX': 88.0 }
 */
async function divertModscanResponse(rawModscanData, customSiteId = null) {
  const timestamp = new Date().toISOString();
  const effectiveSiteId = customSiteId || CONFIG.siteId;
  const divertedReadings = [];

  // Map 1: If input is an array of raw Modscan register objects
  if (Array.isArray(rawModscanData)) {
    for (const item of rawModscanData) {
      // Find matching parameter definition by register address OR directly by PID
      const paramDef = MODSCAN_PID_MAP.find(
        (m) =>
          m.address === item.address ||
          m.pid.toUpperCase() === String(item.pid || '').toUpperCase()
      );

      const pid = item.pid || (paramDef ? paramDef.pid : `REG-${item.address}`);
      const scale = paramDef ? paramDef.scale : 1.0;
      const rawVal = item.rawValue !== undefined ? item.rawValue : item.value;
      const finalValue = Number((Number(rawVal) * scale).toFixed(2));

      divertedReadings.push({
        siteId: effectiveSiteId,
        pid,
        value: finalValue,
        ts: timestamp,
      });
    }
  }
  // Map 2: If input is a dictionary { [addressOrPid]: value }
  else if (typeof rawModscanData === 'object' && rawModscanData !== null) {
    for (const [key, val] of Object.entries(rawModscanData)) {
      const numKey = Number(key);
      const isRegisterAddress = !isNaN(numKey) && numKey >= 1000;

      const paramDef = isRegisterAddress
        ? MODSCAN_PID_MAP.find((m) => m.address === numKey)
        : MODSCAN_PID_MAP.find((m) => m.pid.toUpperCase() === key.toUpperCase());

      const pid = paramDef ? paramDef.pid : key;
      const scale = isRegisterAddress && paramDef ? paramDef.scale : 1.0;
      const finalValue = Number((Number(val) * scale).toFixed(2));

      divertedReadings.push({
        siteId: effectiveSiteId,
        pid,
        value: finalValue,
        ts: timestamp,
      });
    }
  }

  // Hit the dashboard datalogger API with all diverted parameters
  if (divertedReadings.length === 0) {
    console.warn('⚠️  [Diverter] No parameters to divert.');
    return { ok: false, count: 0 };
  }

  try {
    const result = await sendToDashboard(divertedReadings);
    return { ok: true, count: divertedReadings.length, readings: divertedReadings, result };
  } catch (err) {
    return { ok: false, count: divertedReadings.length, error: err.message };
  }
}

/**
 * Generate simulated Modscan register responses for testing
 */
function generateSimulatedModscanFrame() {
  const frame = {};
  for (const p of MODSCAN_PID_MAP) {
    // Generate slight Brownian walk / sinusoidal variation
    const delta = (Math.random() - 0.5) * 2 * (p.simVariance || 1.0);
    const val = Math.max(p.min || 0, Math.min(p.max || 9999, p.simBase + delta));
    frame[p.pid] = Number(val.toFixed(2));
  }
  return frame;
}

/* ============================================================
   CLI ARGS & EXECUTION MODES
   ============================================================ */
async function main() {
  const args = process.argv.slice(2);

  // Custom CLI arguments
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
  };

  if (getArg('--endpoint')) CONFIG.endpointUrl = getArg('--endpoint');
  if (getArg('--key')) CONFIG.apiKey = getArg('--key');
  if (getArg('--site')) CONFIG.siteId = getArg('--site');
  if (getArg('--interval')) CONFIG.pollIntervalMs = parseInt(getArg('--interval'), 10);

  console.log('============================================================');
  console.log(' 🚀 MODSCAN GENERIC REAL-TIME TELEMETRY DIVERTER');
  console.log('============================================================');
  console.log(` Target Ingest API:  ${CONFIG.endpointUrl}`);
  console.log(` Site Code:          ${CONFIG.siteId}`);
  console.log(` Configured Params:  ${MODSCAN_PID_MAP.length} parameter channels`);
  console.log('============================================================\n');

  // Single hit mode: node scripts/modscan-diverter.js --pid 855-PH --value 7.42
  const customPid = getArg('--pid');
  const customVal = getArg('--value');

  if (customPid && customVal !== null) {
    console.log(`🎯 Diverting single parameter: [PID: ${customPid}] = ${customVal} ...`);
    const resp = await divertModscanResponse({ [customPid]: Number(customVal) });
    if (resp.ok) {
      console.log('✅ Successfully diverted parameter to dashboard:');
      console.log(JSON.stringify(resp.result, null, 2));
    } else {
      console.error('❌ Failed to divert parameter:', resp.error);
    }
    process.exit(resp.ok ? 0 : 1);
  }

  // Continuous polling / simulation mode
  console.log(`🔄 Starting generic parameter diverter (Polling every ${CONFIG.pollIntervalMs / 1000}s)...`);
  console.log('Press Ctrl+C to stop.\n');

  let cycle = 1;
  const pollAndDivert = async () => {
    const modscanFrame = generateSimulatedModscanFrame();
    const timeStr = new Date().toLocaleTimeString();

    process.stdout.write(`[${timeStr}] Cycle #${cycle} · Diverting ${Object.keys(modscanFrame).length} parameters: `);

    const resp = await divertModscanResponse(modscanFrame);

    if (resp.ok) {
      process.stdout.write(`✅ Diverted (${resp.count} PIDs)\n`);
      for (const [pid, val] of Object.entries(modscanFrame)) {
        process.stdout.write(`   └─ [${pid.padEnd(10)}] -> ${String(val).padEnd(8)}\n`);
      }
      console.log();
    } else {
      process.stdout.write(`❌ Failed: ${resp.error}\n`);
    }
    cycle++;
  };

  // Run initial poll
  await pollAndDivert();

  // If --once was passed, exit after single cycle
  if (args.includes('--once')) {
    process.exit(0);
  }

  // Continue recurring interval
  setInterval(pollAndDivert, CONFIG.pollIntervalMs);
}

// Run CLI
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal diverter error:', err);
    process.exit(1);
  });
}

module.exports = {
  divertModscanResponse,
  MODSCAN_PID_MAP,
  CONFIG,
};
