const { Client } = require('../backend/node_modules/pg');
const client = new Client({
  connectionString: 'postgresql://saaphzone_user:2ojnbmErthu0g3WkAjIy0kG3C8x9us5l@dpg-dar1uc8473hc739hmh80-a.ohio-postgres.render.com/saaphzone',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  await client.connect();
  const res = await client.query(`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name ILIKE '%board%'
    ORDER BY ordinal_position;
  `);
  console.log('Columns in board tables:');
  console.table(res.rows);
  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
