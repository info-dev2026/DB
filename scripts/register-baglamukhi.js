const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const { saveBoardConfig, pushBoardConfig } = require('../backend/services/cpcbAutoPusher');
const { BoardConfig } = require('../backend/models');

const pem = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAudinq8u6qVOC3VWON6wF
J3lFU4Ry8OSJFw3zWtt4m/1HMZezI34NtAO/6/bj+nc7Qj4fvix75/UYeX+ex/+C
wOGd436uz7ExGkL2vKHSnfhHUCS9JzINoIyYJwaYSRcnU6WG9sAv4dNhtJ69sY49
r6NPWp7w8VALp5e1qGPpJkD/fi5bNEjeACpzvg2aShPPv3YlvgNEiQBaDRBCewNJ
YFQz7TlEzOLc13gLDHhn99neay9JWwGG7R/1YCEFzO1EBg6l1s6eDmHNOd0uULs+
1b/ONjrqWt+SqI+Z/jqqNEJKNcmhlDCTA0XQPYlvnyX4Ojwd/Bi85CabfMAa5k1m
9wIDAQAB
-----END PUBLIC KEY-----`;

async function run() {
  try {
    console.log('1. Saving BoardConfig for BIPL_123 (Baglamukhi) in PostgreSQL...');
    const record = await saveBoardConfig('BIPL_123', 'CPCB', {
      stationId: 'station_13048',
      deviceId: 'device_12161',
      tokenId: '0w0BoTbWlZ8nVnvlMmLqcs3fxW8wSvAxCMFfPM485ZU=',
      publicKeyPem: pem,
      publicKeyFileName: 'public.pem',
      apiUrl: 'https://cems.cpcb.gov.in/v1.0/industry/data',
      payloadMode: 'standard',
      parameters: ['PM'],
      paramUnits: { PM: 'mg/m³' },
      autoPush: true,
      intervalMinutes: 15,
      fallbackSimulation: true,
    });
    console.log('✅ Saved to DB. Record ID:', record.id, 'siteCode:', record.siteCode);

    console.log('\n2. Performing real transmission to CPCB (https://cems.cpcb.gov.in/v1.0/industry/data)...');
    const result = await pushBoardConfig(record);
    console.log('\n============================================================');
    console.log('CPCB Transmission Response:');
    console.log(JSON.stringify(result, null, 2));
    console.log('============================================================');

    const updated = await BoardConfig.findByPk(record.id);
    console.log('\nDatabase Record Status:');
    console.log({
      siteCode: updated.siteCode,
      boardCode: updated.boardCode,
      lastPushedAt: updated.lastPushedAt,
      lastPushStatus: updated.lastPushStatus,
      lastPushMsg: updated.lastPushMsg,
      lastDurationMs: updated.lastDurationMs,
      autoPush: updated.autoPush
    });
  } catch (err) {
    console.error('❌ Error during execution:', err);
  }
  process.exit(0);
}

run();
