// A fortnight of trading, so people can try the system on something that looks
// like their own day rather than on empty tables.
//
//   npm run demo          put it in
//   npm run demo:clear    take it out
//
// Every row this writes is marked, and the marks are what `--clear` goes by —
// not the dates. That matters: the real 2026 figures will land on some of these
// same days, and a teardown that went by date would take them with it.
//
//   gold_txn        doc_no starts DEMO-
//   cash_txn        kt_note = 'DEMO'
//   refining_lot    lot_code starts DEMO-
//   feedback_report description starts 'Demo:'
//
// Prices and accounting periods are not marked. They are reference figures
// rather than transactions, they overwrite cleanly, and removing them would
// take out the day's price somebody had entered by hand.
import pg from 'pg'

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

const CLEAR = process.argv.includes('--clear')
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()

/** Trading days, most recent last. Sundays skipped, the way the shop works. */
const DAYS = [
  '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
  '2026-08-22', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27',
  '2026-08-28', '2026-08-29',
]
const PERIODS = ['2026-07', '2026-08']

// ---------------------------------------------------------------- clearing --

async function clear() {
  // Gold transactions first: a deposit cannot go while a pickup still points at
  // it, and the journal entries cannot go while anything references them.
  const txns = await db.query(
    `SELECT id FROM pc49.gold_txn WHERE doc_no LIKE 'DEMO-%'
      ORDER BY (txn_type::text = 'DEPOSIT')`)
  for (const t of txns.rows) {
    await db.query(`DELETE FROM pc49.inventory_movement WHERE source_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.cash_txn WHERE gold_txn_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.gold_txn WHERE id = $1`, [t.id])
  }

  await db.query(`DELETE FROM pc49.cash_txn WHERE kt_note = 'DEMO'`)
  await db.query(`DELETE FROM pc49.refining_lot_line WHERE lot_id IN (
                    SELECT id FROM pc49.refining_lot WHERE lot_code LIKE 'DEMO-%')`)
  await db.query(`DELETE FROM pc49.refining_receipt WHERE lot_id IN (
                    SELECT id FROM pc49.refining_lot WHERE lot_code LIKE 'DEMO-%')`)
  await db.query(`DELETE FROM pc49.refining_lot WHERE lot_code LIKE 'DEMO-%'`)
  await db.query(`DELETE FROM pc49.feedback_report WHERE description LIKE 'Demo:%'`)

  // Journal entries are left orphaned by the deletions above. Unpost before
  // touching the lines: a posted entry's lines are immutable, which is the same
  // road the system puts everybody else on.
  await db.query(
    `UPDATE pc49.journal_entry SET posted_at = NULL
      WHERE period = ANY($1) AND id NOT IN (
        SELECT journal_entry_id FROM pc49.gold_txn WHERE journal_entry_id IS NOT NULL
        UNION SELECT journal_entry_id FROM pc49.cash_txn WHERE journal_entry_id IS NOT NULL)`,
    [PERIODS])
  await db.query(
    `DELETE FROM pc49.journal_line WHERE entry_id IN (
       SELECT id FROM pc49.journal_entry WHERE period = ANY($1) AND posted_at IS NULL)`,
    [PERIODS])
  await db.query(
    `DELETE FROM pc49.journal_entry WHERE period = ANY($1) AND posted_at IS NULL
       AND reversal_of_id IS NOT NULL`, [PERIODS])
  await db.query(
    `DELETE FROM pc49.journal_entry WHERE period = ANY($1) AND posted_at IS NULL`, [PERIODS])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)

  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE doc_no LIKE 'DEMO-%') AS txns,
            (SELECT count(*)::int FROM pc49.cash_txn WHERE kt_note = 'DEMO') AS cash,
            (SELECT count(*)::int FROM pc49.refining_lot WHERE lot_code LIKE 'DEMO-%') AS lots,
            (SELECT count(*)::int FROM pc49.feedback_report
              WHERE description LIKE 'Demo:%') AS reports`)
  const r = left.rows[0]
  const clean = Object.values(r).every((n) => n === 0)
  console.log(clean
    ? 'demo data removed'
    : `STILL THERE: ${r.txns} txns, ${r.cash} cash, ${r.lots} lots, ${r.reports} reports`)
  return clean
}

// ----------------------------------------------------------------- seeding --

/** Gold's dollar price per ounce on each day, wandering the way it does. */
const SPOT = [2384.10, 2391.50, 2379.80, 2402.30, 2415.60,
              2408.90, 2421.40, 2418.70, 2433.20, 2427.50, 2439.80, 2444.10]

/** What each type trades at relative to the spot gram, as this shop prices it. */
const PREMIUM = {
  GRAIN: 0.995, SG: 0.972, 9999: 1.004, RP: 1.062, AE: 1.081, CS: 1.055, ML: 1.074,
}

/**
 * The unit each type is traded, priced and reported in.
 *
 * This is not decoration. `gold_price_daily` holds the price per this unit and
 * the books multiply it by the quantity as written, so a row measured in
 * anything else is priced against a number that means something else. It is
 * read from `gold_type.native_uom` at the start of a run rather than written
 * out here, so the demo cannot drift from what the system believes.
 */
let NATIVE = {}
const GRAMS_PER = { GRAM: 1, OZ: 31.105, LUONG: 37.5 }

const round = (n, dp = 2) => Number(n.toFixed(dp))
/** Valuation divides by 31.1, not the 31.105 used for converting weight. */
const gramFromOz = (oz) => oz / 31.1

async function loadNativeUnits() {
  const r = await db.query(`SELECT code, native_uom FROM pc49.gold_type`)
  NATIVE = Object.fromEntries(r.rows.map((g) => [g.code, g.native_uom]))
}

async function seedPrices() {
  for (const [i, day] of DAYS.entries()) {
    const oz = SPOT[i]
    // The per-gram figure is a generated column: the divisor lives in the
    // schema, which is the only place it should live.
    for (const [metal, perOz] of [['GOLD', oz], ['PLATINUM', round(oz * 0.412)]]) {
      await db.query(
        `INSERT INTO pc49.spot_price_daily (price_date, metal, spot_per_oz, source)
         VALUES ($1, $2, $3, 'demo')
         ON CONFLICT (price_date, metal)
         DO UPDATE SET spot_per_oz = $3, source = 'demo'`, [day, metal, perOz])
    }

    for (const [code, factor] of Object.entries(PREMIUM)) {
      // Per luong for Rong Phung, per ounce for the coins, per gram for scrap.
      const price = round(gramFromOz(oz) * factor * GRAMS_PER[NATIVE[code]])
      await db.query(
        `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
         VALUES ($1, $2, $3)
         ON CONFLICT (price_date, gold_type_code) DO UPDATE SET market_price = $3`,
        [day, code, price])
    }
  }
  console.log(`prices for ${DAYS.length} days`)
}

async function seedPeriods() {
  for (const period of PERIODS) {
    await db.query(
      `INSERT INTO pc49.accounting_period (period, status) VALUES ($1, 'OPEN')
       ON CONFLICT (period) DO NOTHING`, [period])
  }
  console.log(`${PERIODS.length} accounting periods, open`)
}

/** The shop's regulars, so the same names recur the way they would. */
const CUSTOMERS = ['Chi Lan', 'Anh Dung', 'Co Bay', 'Chu Thanh', 'Chi Hoa',
                   'Anh Phuc', 'Ba Tam', 'Chi Nguyet']
const VENDORS = ['Kim Thanh Co', 'Dai Loi Gold', 'Phu Quy Metals']
const SELLERS = ['B.Khanh', 'H.Kim', 'S.Mai', 'T.Vân', 'P.Minh']

/** A small deterministic shuffle, so two runs produce the same day's trading. */
function pick(list, n) { return list[n % list.length] }

async function seedGold() {
  let doc = 0
  const next = () => `DEMO-${String(++doc).padStart(4, '0')}`
  const priceOn = async (day, code) => {
    const r = await db.query(
      `SELECT market_price::float8 p FROM pc49.gold_price_daily
        WHERE price_date = $1 AND gold_type_code = $2`, [day, code])
    return r.rows[0].p
  }

  const deposits = []

  // Stocking up before the fortnight starts. Without it the shop sells coins it
  // never bought: inventory goes negative on four types and the cost of sales
  // is nonsense, because there is no cost to draw on. That is a real condition
  // the system warns about, but it is not the state to hand somebody who is
  // seeing the screens for the first time.
  const OPENING_STOCK = [
    ['RP',   20, 'Rong Phung nhap dau ky'],
    ['AE',   16, 'American Eagle nhap dau ky'],
    ['CS',   16, 'Credit Suisse nhap dau ky'],
    ['9999', 16, 'Vang 9999 nhap dau ky'],
    ['ML',    6, 'Maple Leaf nhap dau ky'],
  ]
  for (const [code, qty, note] of OPENING_STOCK) {
    const price = round(await priceOn(DAYS[0], code) * 0.994)
    await db.query(
      `INSERT INTO pc49.gold_txn (txn_date, doc_no, txn_type, partner_code,
         gold_type_code, uom, qty, unit_price, amount, remarks)
       VALUES ($1, $2, 'PO_VENDOR', $3, $4, $5, $6, $7, $8, $9)`,
      [DAYS[0], next(), 'Kim Thanh Co', code, NATIVE[code], qty, price,
       round(-qty * price), note])
  }

  for (const [i, day] of DAYS.entries()) {
    // Scrap bought over the counter. This is most of what walks in.
    for (let k = 0; k < 2; k += 1) {
      const qty = round(8 + ((i * 7 + k * 13) % 26) + (k ? 0.4 : 0.85), 2)
      const price = round(await priceOn(day, 'SG') * 0.985)
      await db.query(
        `INSERT INTO pc49.gold_txn (txn_date, doc_no, txn_type, partner_code, sales_person_code,
           gold_type_code, scrap_detail, uom, qty, unit_price, amount, remarks)
         VALUES ($1, $2, 'PO', $3, $4, 'SG', $5, $6, $7, $8, $9, $10)`,
        [day, next(), pick(CUSTOMERS, i * 3 + k), pick(SELLERS, i + k),
         ['14K', '18K', '10K'][(i + k) % 3], NATIVE.SG, qty, price, round(-qty * price),
         k === 0 ? 'vang cu doi' : null])
    }

    // Grain from a supplier, twice a week.
    if (i % 3 === 1) {
      const qty = round(120 + (i % 4) * 30, 2)
      const price = round(await priceOn(day, 'GRAIN'))
      await db.query(
        `INSERT INTO pc49.gold_txn (txn_date, doc_no, txn_type, partner_code,
           gold_type_code, uom, qty, unit_price, amount, remarks)
         VALUES ($1, $2, 'PO_VENDOR', $3, 'GRAIN', $4, $5, $6, $7, 'nhap si')`,
        [day, next(), pick(VENDORS, i), NATIVE.GRAIN, qty, price, round(-qty * price)])
    }

    // Selling. Coins to customers, refined gold on internally.
    for (let k = 0; k < 2; k += 1) {
      const code = ['RP', 'AE', '9999', 'CS'][(i + k) % 4]
      // One or two of whatever that type comes in — a luong of Rong Phung, an
      // ounce of Eagle. Nobody buys 14.6 grams of a coin.
      const qty = -(1 + ((i + k) % 2))
      const price = round(await priceOn(day, code) * 1.025)
      await db.query(
        `INSERT INTO pc49.gold_txn (txn_date, doc_no, txn_type, partner_code, sales_person_code,
           gold_type_code, uom, qty, unit_price, amount, remarks)
         VALUES ($1, $2, 'SALE', $3, $4, $5, $6, $7, $8, $9, $10)`,
        [day, next(), pick(CUSTOMERS, i * 5 + k + 1), pick(SELLERS, i * 2 + k),
         code, NATIVE[code], qty, price, round(-qty * price),
         k === 1 && i % 4 === 0 ? 'khach quen, bot 20' : null])
    }

    // A customer orders a coin and leaves a deposit. Some come back for it.
    if (i % 4 === 2) {
      const paid = round(400 + (i % 3) * 150)
      // The agreed price for the whole order, which is what makes "still owed"
      // an exact figure rather than a guess at today's gold price. The entry
      // screen will not save a deposit without one.
      const agreed = round(await priceOn(day, 'RP') * 1.025)
      const r = await db.query(
        `INSERT INTO pc49.gold_txn (txn_date, doc_no, txn_type, partner_code, sales_person_code,
           gold_type_code, uom, qty, unit_price, amount, remarks)
         VALUES ($1, $2, 'DEPOSIT', $3, $4, 'RP', 'LUONG', -1, $5, $6,
                 'dat coc 1 luong Rong Phung')
         RETURNING id`,
        [day, next(), pick(CUSTOMERS, i + 2), pick(SELLERS, i), agreed, paid])
      deposits.push({ id: r.rows[0].id, paid, day, dayIndex: i })
    }
  }

  // All but the most recent deposit gets collected, so the screen has both an
  // order still waiting and orders that closed.
  for (const d of deposits.slice(0, -1)) {
    const collectOn = DAYS[Math.min(d.dayIndex + 3, DAYS.length - 1)]
    const price = round(await priceOn(collectOn, 'RP') * 1.025)
    await db.query(
      `INSERT INTO pc49.gold_txn (txn_date, doc_no, txn_type, partner_code,
         gold_type_code, uom, qty, amount, deposit_ref_id, remarks)
       VALUES ($1, $2, 'PICKUP', (SELECT partner_code FROM pc49.gold_txn WHERE id = $3),
               'RP', 'LUONG', -1, $4, $3, 'khach toi lay')`,
      [collectOn, next(), d.id, round(price - d.paid)])
  }

  // How each one was settled. A purchase will not post without this, and
  // rightly: the system refuses to book money leaving without saying where it
  // left from. Sales post either way, so some are left unpaid on purpose —
  // that is what puts figures in the receivables report.
  const toPay = await db.query(
    `SELECT id, txn_type::text AS type, amount::float8 AS amount, doc_no
       FROM pc49.gold_txn WHERE doc_no LIKE 'DEMO-%' ORDER BY doc_no`)
  let paid = 0
  for (const t of toPay.rows) {
    const nth = Number(t.doc_no.slice(5))
    // Roughly one sale in five is still owed to us at the end of the fortnight.
    if (t.type === 'SALE' && nth % 5 === 0) continue
    const method = t.type === 'PO_VENDOR' ? 'BANKWIRE'
      : t.type === 'SALE' && nth % 7 === 0 ? 'ZELLE'
      : t.type === 'SALE' && nth % 11 === 0 ? 'CHECK'
      : 'CASH'
    // AP when the money is ours going out, AR when it is coming in.
    const direction = t.amount < 0 ? 'AP' : 'AR'
    await db.query(
      `INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method, paid_at)
       VALUES ($1, 1, $2, $3, $4, (SELECT txn_date FROM pc49.gold_txn WHERE id = $1))`,
      [t.id, direction, Math.abs(t.amount), method])
    paid += 1
  }
  console.log(`${paid} of ${toPay.rows.length} settled at the counter`)

  // Writing the row does not put it in the books. Posting is its own step, the
  // way it is for anybody using the screen — and it is what produces the
  // journal entry and, through the trigger, the stock movement. Without it the
  // ledger, the reports and the inventory are all still empty and the demo
  // shows nothing worth looking at.
  const unposted = await db.query(
    `SELECT id, doc_no FROM pc49.gold_txn
      WHERE doc_no LIKE 'DEMO-%' AND journal_entry_id IS NULL ORDER BY txn_date, doc_no`)
  const failed = []
  for (const t of unposted.rows) {
    try {
      await db.query(`SELECT pc49.post_gold_txn($1)`, [t.id])
    } catch (e) {
      failed.push(`${t.doc_no}: ${e.message}`)
    }
  }

  const n = await db.query(
    `SELECT count(*)::int c,
            count(*) FILTER (WHERE journal_entry_id IS NOT NULL)::int posted
       FROM pc49.gold_txn WHERE doc_no LIKE 'DEMO-%'`)
  console.log(`${n.rows[0].c} gold transactions, ${n.rows[0].posted} posted, `
            + `${deposits.length} deposits (${deposits.length - 1} collected, 1 still waiting)`)
  if (failed.length) {
    console.log(`  ${failed.length} would not post:`)
    for (const f of failed.slice(0, 5)) console.log(`    ${f}`)
  }
}

async function seedCash() {
  const OPENING = [
    ['1111', 18_450.00], ['1121-3388', 264_800.00], ['1121-9530', 91_250.00],
    ['1121-6086', 37_900.00], ['1121ZL', 0], ['1121BW', 0], ['1121CK', 4_120.00],
  ]
  for (const [code, amount] of OPENING) {
    await db.query(
      `INSERT INTO pc49.cash_opening_balance (cash_account_code, as_of, amount, note)
       VALUES ($1, '2026-08-01', $2, 'demo')
       ON CONFLICT (cash_account_code, as_of) DO UPDATE SET amount = $2`, [code, amount])
  }

  // The money that is not gold: rent, wages, a wire from a buyer, card fees.
  const MOVES = [
    ['2026-08-17', '1121-3388', 'IN',  42_500.00, 'Wire tu Kim Thanh Co', 'Kim Thanh Co'],
    ['2026-08-18', '1111',      'OUT',  1_240.00, 'Tien mat tra khach ban vang cu', null],
    ['2026-08-19', '1121-9530', 'OUT', 12_800.00, 'Thanh toan Dai Loi Gold', 'Dai Loi Gold'],
    ['2026-08-20', '1121-3388', 'OUT',  3_600.00, 'Tien thue mat bang thang 8', null],
    ['2026-08-21', '1121ZL',    'IN',   2_150.00, 'Zelle khach le', null],
    ['2026-08-24', '1121-3388', 'OUT',  8_900.00, 'Luong nhan vien ky 1', null],
    ['2026-08-25', '1121-6086', 'IN',  15_400.00, 'Chuyen khoan tu TL Wis', null],
    ['2026-08-26', '1111',      'IN',   3_780.00, 'Thu tien mat ban le', null],
    ['2026-08-27', '1121-9530', 'OUT',    485.00, 'Phi ngan hang thang 8', null],
    ['2026-08-28', '1121CK',    'IN',   6_200.00, 'Check khach Chi Nguyet', 'Chi Nguyet'],
    ['2026-08-29', '1121-3388', 'OUT', 21_000.00, 'Tam ung mua vang si', 'Phu Quy Metals'],
  ]
  for (const [day, code, dir, amount, description, party] of MOVES) {
    await db.query(
      `INSERT INTO pc49.cash_txn (txn_date, cash_account_code, direction, amount,
         description, counterparty, source, kt_note)
       VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', 'DEMO')`,
      [day, code, dir, amount, description, party])
  }
  console.log(`${OPENING.length} opening balances, ${MOVES.length} cash movements`)
}

async function seedRefining() {
  // One lot away at the refinery, which is what the dashboard's "dang phan kim"
  // counts, and one that came back so the screen shows a finished one too.
  const away = await db.query(
    `INSERT INTO pc49.refining_lot
       (lot_code, status, refinery_name, sent_date, spot_gold_per_oz_sent, fee_pct_gold, note)
     VALUES ('DEMO-LOT-02', 'SENT', 'Metalor US', '2026-08-25', 2433.20, 1.75,
             'vang cu gom tu 18/08 den 24/08')
     RETURNING id`)
  const done = await db.query(
    `INSERT INTO pc49.refining_lot
       (lot_code, status, refinery_name, sent_date, spot_gold_per_oz_sent,
        assay_date, spot_gold_per_oz_assay, received_date, fee_pct_gold, note)
     VALUES ('DEMO-LOT-01', 'RECEIVED', 'Metalor US', '2026-08-10', 2371.40,
             '2026-08-16', 2402.30, '2026-08-19', 1.75, 'lot dau thang')
     RETURNING id`)

  const LINES = [
    [away.rows[0].id, 1, 'PC49', 'SG', 'vang cu 14K khach doi', 428.60, 0.583],
    [away.rows[0].id, 2, 'PC49', 'SG', 'vang cu 18K', 216.40, 0.750],
    [away.rows[0].id, 3, 'PC49', 'OTH', 'vun day chuyen', 94.20, 0.417],
    [done.rows[0].id, 1, 'PC49', 'SG', 'vang cu 14K', 512.30, 0.583],
    [done.rows[0].id, 2, 'PC49', 'SG', 'vang cu 18K', 188.90, 0.750],
  ]
  for (const [lot, seq, owner, code, desc, gross, pct] of LINES) {
    // Pure weight is generated from gross and the percentage, so it is not ours
    // to write — the same reason the spot per-gram figure is not.
    await db.query(
      `INSERT INTO pc49.refining_lot_line
         (lot_id, seq, owner_code, metal, source_desc, gold_type_code,
          gross_weight_gram, gold_pct)
       VALUES ($1, $2, $3, 'GOLD', $4, $5, $6, $7)`,
      [lot, seq, owner, desc, code, gross, pct])
  }
  // The lot that came back has been assayed and received, so the demo shows a
  // whole cycle rather than two lots frozen halfway. A received lot with no
  // assay reads as "sent" everywhere, which is not a state that should exist.
  //
  // The refinery reports a little under what the scrap book said, as it does:
  // the assay is the honest weight and the book was somebody's estimate.
  const assayed = await db.query(
    `UPDATE pc49.refining_lot_line
        SET assay_pct = round(gold_pct * 0.994, 4),
            assay_weight_gram = round(gross_weight_gram * gold_pct * 0.994, 3)
      WHERE lot_id = $1 RETURNING assay_weight_gram`, [done.rows[0].id])
  const back = assayed.rows.reduce((sum, r) => sum + Number(r.assay_weight_gram), 0)

  await db.query(
    `INSERT INTO pc49.refining_receipt
       (lot_id, receive_date, gold_type_code, owner_code, qty_gram, unit_price)
     VALUES ($1, '2026-08-19', 'GRAIN', 'PC49', $2, $3)`,
    [done.rows[0].id, round(back, 3), round(2402.30 / 31.1, 2)])

  console.log(`2 refining lots (1 away at the refinery, 1 back with `
            + `${round(back, 2)} g assayed and received), 5 lines`)
}

async function seedFeedback() {
  const REPORTS = [
    ['WRONG_NUMBER', 'BLOCKING', 'KT',
     'Demo: tong ban ra ngay 26/08 lech 180 so voi so viet tay, hinh nhu dong ban cho Chi Hoa tinh sai don gia',
     '/gold-transactions?date=2026-08-26', '/gold-transactions', 'Giao dich vang', 'NEW', null],
    ['BROKEN', 'SLOWS_WORK', 'KT',
     'Demo: bam xuat file o man hinh bao cao thi khong thay gi tai ve, phai lam lai 3 lan moi duoc',
     '/reports?report=trial-balance&period=2026-08', '/reports', 'Bao cao', 'LOOKING', null],
    ['SUGGESTION', 'MINOR', 'OC',
     'Demo: man hinh tong quan nen co luon so ban ra hom nay, khong phai bam vao tung trang',
     '/', '/', 'Tong quan', 'DECLINED', 'Dang lam roi, se co trong ban thang sau'],
  ]
  for (const [kind, impact, role, text, url, route, title, status, note] of REPORTS) {
    await db.query(
      `INSERT INTO pc49.feedback_report
         (kind, impact, description, page_url, page_route, page_title, status, triage_note,
          reporter_id, reporter_role, triaged_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::pc49.feedback_status, $8,
               (SELECT id FROM pc49.app_user WHERE role = $9::pc49.user_role LIMIT 1), $9,
               CASE WHEN $7 = 'NEW' THEN NULL ELSE now() END)`,
      [kind, impact, text, url, route, title, status, note, role])
  }
  console.log(`${REPORTS.length} reports in the queue, one of each state`)
}

// -------------------------------------------------------------------- main --

try {
  if (CLEAR) {
    const clean = await clear()
    process.exitCode = clean ? 0 : 1
  } else {
    // Start from a known state, so running it twice does not double the day.
    await clear()
    await loadNativeUnits()
    await seedPeriods()
    await seedPrices()
    await seedGold()
    await seedCash()
    await seedRefining()
    await seedFeedback()

    const summary = await db.query(
      `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE doc_no LIKE 'DEMO-%') AS txns,
              (SELECT count(*)::int FROM pc49.journal_entry
                WHERE period = ANY($1) AND posted_at IS NOT NULL) AS posted,
              (SELECT count(*)::int FROM pc49.inventory_movement) AS movements`, [PERIODS])
    const s = summary.rows[0]
    console.log(`\n${s.txns} transactions posted ${s.posted} journal entries `
              + `and ${s.movements} stock movements.`)
    console.log(`Sign in and look at ${DAYS[DAYS.length - 1]}. `
              + `Run "npm run demo:clear" to take it all out again.`)
  }
} finally {
  await db.end()
}
