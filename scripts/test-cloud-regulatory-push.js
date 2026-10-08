/* ============================================================
   scripts/test-cloud-regulatory-push.js
   Test & verify 24/7 cloud regulatory transmission to CPCB/SPCB
   ============================================================ */

const http = require('http');
const https = require('https');

const targetUrl = process.argv[2] || 'https://saaphzone-backend.onrender.com/api/portal/live/autopush/trigger';

console.log('============================================================');
console.log('  Testing 24/7 Cloud Regulatory Transmission Engine');
console.log('  Target:', targetUrl);
console.log('============================================================\n');

const url = new URL(targetUrl);
const client = url.protocol === 'https:' ? https : http;

const postData = JSON.stringify({});

const req = client.request(
  {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + (url.search || ''),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 25000,
  },
  (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      console.log(`Status Code: ${res.statusCode} ${res.statusMessage}`);
      try {
        const json = JSON.parse(body);
        console.log('Response JSON:\n', JSON.stringify(json, null, 2));
      } catch {
        console.log('Raw Response:\n', body);
      }
    });
  }
);

req.on('error', (e) => {
  console.error('Request failed:', e.message);
});

req.write(postData);
req.end();
