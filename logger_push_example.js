/* =============================================================
   Example: how your data logger / Raspberry Pi pushes readings
   to the backend. Run with:  node logger_push_example.js
   Replace LOGGER_KEY and BASE with your own values.
   ============================================================= */
const BASE = 'http://localhost:8080/api';
const LOGGER_KEY = 'sz_logger_REPLACE_WITH_YOUR_KEY';

async function pushReadings(readings){
  const res = await fetch(BASE + '/ingest', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'X-API-Key': LOGGER_KEY },
    body: JSON.stringify({ readings })
  });
  console.log(await res.json());
}

// Example: send one 15-minute average per channel.
// Identify the channel by siteId+param, or by the unique pid.
pushReadings([
  { siteId:'ESK-4417', param:'PM',  value: 42.7 },
  { siteId:'ESK-4417', param:'SO2', value: 180.4 },
  { pid:'KRK-0392-COD', value: 245.1 },
]);

/* In real use you'd run this on a timer, reading from your
   analyzer/Modbus/GPRS source instead of hard-coded values:

   setInterval(async () => {
     const readings = await readFromAnalyzers();   // your code
     await pushReadings(readings);
   }, 15 * 60 * 1000);                              // every 15 min
*/
