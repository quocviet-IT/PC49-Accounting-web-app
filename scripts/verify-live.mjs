// Reads the live database and checks the P0/P1 acceptance criteria.
// Run: npm run verify:live
import pg from 'pg'

const url = process.env.SUPABASE_DB_URL
if (!url) { console.error('Missing environment variable: SUPABASE_DB_URL'); process.exit(1) }

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

let failures = 0
async function check(name, sql, expected) {
  const r = await c.query(sql)
  const got = r.rows.length === 1 && Object.keys(r.rows[0]).length === 1
    ? Object.values(r.rows[0])[0]
    : r.rows
  const ok = JSON.stringify(got) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(expected)}`}`)
}

await check('migrations applied',
  `SELECT count(*)::int AS n FROM pc49.schema_migrations`, 7)
await check('gold types seeded',
  `SELECT count(*)::int AS n FROM pc49.gold_type`, 9)
await check('accounts seeded',
  `SELECT count(*)::int AS n FROM pc49.account`, 45)
await check('flow rules seeded',
  `SELECT count(*)::int AS n FROM pc49.gold_flow_rule`, 74)
await check('system parameters seeded',
  `SELECT count(*)::int AS n FROM pc49.system_param`, 6)
await check('oz weight factor is 31.105',
  `SELECT gram_per_unit::text AS v FROM pc49.uom_factor WHERE uom = 'OZ'`, '31.10500')
await check('valuation divisor is 31.1',
  `SELECT value::text AS v FROM pc49.system_param WHERE key = 'VALUATION_GRAM_PER_OZ'`, '31.100000')
await check('refining loss gold 0.5 percent',
  `SELECT value::text AS v FROM pc49.system_param WHERE key = 'REFINING_FEE_PCT_GOLD'`, '0.500000')
await check('refining loss platinum 5 percent',
  `SELECT value::text AS v FROM pc49.system_param WHERE key = 'REFINING_FEE_PCT_PT'`, '5.000000')
await check('scrap gold leaves only by sale or refining',
  `SELECT txn_type::text FROM pc49.gold_flow_rule
    WHERE gold_type_code = 'SG' AND direction = 'OUT' ORDER BY txn_type::text`,
  [{ txn_type: 'SALE' }, { txn_type: 'TRANSFER_OUT' }])
await check('every gold type account exists',
  `SELECT count(*)::int AS n FROM pc49.gold_type g
    WHERE NOT EXISTS (SELECT 1 FROM pc49.account a WHERE a.code = g.cogs_account)
       OR NOT EXISTS (SELECT 1 FROM pc49.account a WHERE a.code = g.inventory_account)
       OR NOT EXISTS (SELECT 1 FROM pc49.account a WHERE a.code = g.in_transit_account)`, 0)
await check('row level security on every pc49 table',
  `SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pc49' AND c.relkind = 'r' AND NOT c.relrowsecurity`, 0)

// The costing rule, exercised on the live database with the figures from the
// workbooks, then cleaned up.
await c.query(`
  INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price, avg_purchase_price)
  VALUES ('2026-01-30', '9999', 5893.156626506024, 6763.272727),
         ('2026-01-31', '9999', 5893.156626506024, NULL)
  ON CONFLICT (price_date, gold_type_code) DO UPDATE
    SET market_price = excluded.market_price, avg_purchase_price = excluded.avg_purchase_price`)

await check('cogs_price uses the purchase price when there was one',
  `SELECT round(pc49.cogs_price('2026-01-30', '9999'), 6)::text AS v`, '6763.272727')
await check('cogs_price falls back to market price',
  `SELECT round(pc49.cogs_price('2026-01-31', '9999'), 6)::text AS v`, '5893.156627')

await c.query(`DELETE FROM pc49.gold_price_daily WHERE price_date IN ('2026-01-30','2026-01-31')`)

await c.end()
console.log(failures === 0 ? '\nALL LIVE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
