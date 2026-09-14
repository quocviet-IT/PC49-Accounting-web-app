// Bộ phiên dịch: bảng tính 2026 của khách → CSV đúng khuôn bộ nạp.
//
//   node scripts/sheet-to-import.mjs
//
// Đọc  import-raw/dashboard.xlsx   (US_PC49 DASHBOARD 2026, tab PC49 Sale 01–06.2026)
//      import-raw/scrap.xlsx       (US_Scrap Gold Report 2026, tab 1.Scrap Gold, PT Scrap)
// Ghi  import-csv/01-gold-txn-2026-MM.csv   sáu tệp, mỗi tháng một lô nạp
//      import-csv/03-opening-inventory.csv  tồn đầu 01/01/2026
//
// Cả hai thư mục nằm trong .gitignore: đây là dữ liệu thật của khách, và repo
// này công khai.
//
// Bộ phiên dịch chỉ đổi tên cột và tra bảng. Ba việc nó tự làm, theo kế hoạch:
//
//   1. Dòng Pickup thành hai dòng — phiếu cọc rồi phiếu giao hàng, cùng
//      deposit_key, cả hai mang dấu của phiếu bán. Hai dòng đi chung tệp của
//      tháng có dòng gốc, kể cả khi ngày giao hàng rơi sang tháng sau: bộ nạp
//      chỉ nối giao hàng với phiếu cọc trong cùng một lần commit.
//   2. conv_key chỉ đặt cho ngày chuyển đổi cân được trọng lượng. Ngày lệch để
//      trống cho bộ nạp trả lại kèm lý do.
//   3. % vàng lấy từ 1.Scrap Gold, chỉ khi ghép được đúng một dòng.
//
// Việc CHƯA làm được, và bảng tổng kết nói ra:
//
//   - 02-refining-lots.csv và cột lot_code: cần BC 201 Sales Report (tab 3.2
//     PC49 SCRAP GOLD, 3.3 MH SCRAP GOLD) trong import-raw/. Không có nó, các
//     dòng gửi phân kim vàng vụn/bạch kim không có lô và bộ nạp sẽ trả lại.
//   - Tồn đầu RP, ML, CS, OTH, GRAIN: cần GENERAL REPORT 2026 (tab A.REPORT
//     IN/OUT). Tạm lấy con số của đặc tả đã chốt ngày 10-09, ghi rõ nguồn trong
//     cột note để không ai tưởng nó được đọc từ tệp.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWorkbook } from './lib/xlsx.mjs'
import { excelDate, isNoteNotCustomer } from './lib/sheet-map.mjs'
import {
  TXN_COLUMNS, readTab, toImportRows, assignConversionKeys, dropCarriedOver, toCsv,
} from './lib/sheet-rows.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const RAW = join(ROOT, 'import-raw')
const OUT = join(ROOT, 'import-csv')
const MONTHS = ['01', '02', '03', '04', '05', '06']

function workbook(name) {
  const path = join(RAW, name)
  if (!existsSync(path)) {
    console.error(`Thiếu ${path}. Tải bảng tính gốc về import-raw/ trước.`)
    process.exit(1)
  }
  return readWorkbook(readFileSync(path))
}

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

const dashboard = workbook('dashboard.xlsx')
const scrap = workbook('scrap.xlsx')

// ── % vàng ──────────────────────────────────────────────────────────────────
// 1.Scrap Gold ghi % vàng cho một phần các lần mua vàng vụn; dashboard thì không
// có cột này. Ghép theo (ngày, trọng lượng, số tiền), và chỉ nhận khi mỗi bên có
// đúng một dòng mang khoá đó — hai dòng giống hệt nhau thì không biết % nào của ai.
const pctKey = (date, qty, amount) => `${date}|${Number(qty).toFixed(2)}|${Math.round(Number(amount))}`

function scrapTab(name) {
  const rows = scrap.get(name) ?? []
  const head = (rows[3] ?? []).map(norm)
  const at = (re) => head.findIndex((h) => re.test(h))
  return { rows, date: at(/^Date$/), pct: at(/^% Gold/), weight: at(/^Weight/), amount: at(/^Amount$/) }
}

const sg = scrapTab('1.Scrap Gold')
const pctByKey = new Map()
const pctSeen = new Map()
for (const r of sg.rows.slice(4)) {
  const date = typeof r[sg.date] === 'number' ? excelDate(r[sg.date]) : null
  if (!date || r[sg.pct] === '' || r[sg.pct] === undefined) continue
  const k = pctKey(date, r[sg.weight], r[sg.amount])
  pctSeen.set(k, (pctSeen.get(k) ?? 0) + 1)
  pctByKey.set(k, Number(r[sg.pct]))
}

// ── Giao dịch, từng tháng ───────────────────────────────────────────────────
const records = new Map(MONTHS.map((m) => [m, readTab(dashboard.get(`PC49 Sale ${m}.2026`))]))

const dashSeen = new Map()
for (const list of records.values()) {
  for (const x of list) {
    if (x.desc !== 'Scrap gold') continue
    const k = pctKey(x.date, x.qty, x.amount)
    dashSeen.set(k, (dashSeen.get(k) ?? 0) + 1)
  }
}

mkdirSync(OUT, { recursive: true })
const summary = []
const refusedPct = []

// Lượt một: mọi tab thành dòng nạp, trước khi quyết dòng nào ở lại.
const built = {}
const pctAttachedBy = {}
for (const [month, list] of records) {
  const rows = []
  let pctAttached = 0
  for (const x of list) {
    if (x.desc === 'Scrap gold') {
      const k = pctKey(x.date, x.qty, x.amount)
      const pct = pctByKey.get(k)
      if (pct !== undefined && pctSeen.get(k) === 1 && dashSeen.get(k) === 1) {
        // Ràng buộc 0047: một phân số trong (0, 1]. Con số viết theo phần trăm
        // không được chia hộ — nói ra để người ta sửa sheet.
        if (pct > 0 && pct <= 1) { x.goldPct = String(pct); pctAttached++ } else refusedPct.push(`${x.date} ${pct}`)
      }
    }
    rows.push(...toImportRows(x))
  }
  built[month] = rows
  pctAttachedBy[month] = pctAttached
}

// Lượt hai: dòng chép sang tab tháng sau chỉ nạp một lần, từ tab của chính nó.
// Phải làm trước khi đặt khoá quy đổi — nếu không, hai dòng ngày 03/01 nằm trong
// tab tháng 2 sẽ thành một "ngày chuyển đổi" riêng của tệp tháng 2.
const { tabs: kept, dropped } = dropCarriedOver(built)
if (dropped.length) {
  console.log(`Bỏ ${dropped.length} dòng chép sang tab sau (giống hệt bản ở tab của chính ngày đó):`)
  for (const d of dropped) {
    console.log(`  tab ${d.tab} ← tab ${d.from}: ${d.row.txn_date} ${d.row.txn_type} ` +
      `${d.row.gold_type_code} ${d.row.qty} ${d.row.amount} ${d.row.partner_code || d.row.remarks}`)
  }
}

for (const [month, list] of records) {
  const rows = kept[month]
  const pctAttached = pctAttachedBy[month]
  assignConversionKeys(rows)

  const file = `01-gold-txn-2026-${month}.csv`
  writeFileSync(join(OUT, file), toCsv(rows, TXN_COLUMNS), 'utf8')

  const conversions = rows.filter((r) => ['TRANSFER_IN', 'TRANSFER_OUT', 'RA_RP'].includes(r.txn_type))
  summary.push({
    'Tệp': file,
    'Dòng sheet': list.length,
    'Bản chép bỏ': dropped.filter((d) => d.tab === month).length,
    'Dòng CSV': rows.length,
    'Pickup tách': list.filter((x) => x.type === 'Pickup').length,
    'Chuyển đổi': conversions.length,
    'có khoá': conversions.filter((r) => r.conv_key).length,
    'không khoá': conversions.filter((r) => !r.conv_key).length,
    '  trong đó SG/PT': conversions.filter((r) => !r.conv_key && ['SG', 'PT'].includes(r.gold_type_code)).length,
    'Ô khách là ghi chú': list.filter((x) => isNoteNotCustomer(x.customer)).length,
    '% vàng gắn được': pctAttached,
    'Thiếu loại vàng': rows.filter((r) => !r.gold_type_code).length,
  })
}

// ── Tồn đầu 01/01/2026 ──────────────────────────────────────────────────────
function beginWeight(tabName) {
  const t = scrapTab(tabName)
  const row = t.rows.find((r) => /^begin$/i.test(norm(r?.[0])))
  return row ? Number(row[t.weight]) : null
}
const DESIGN = 'đặc tả 2026-09-10 (GENERAL REPORT không có trong import-raw/)'
const opening = [
  { gold_type_code: 'RP', uom: 'LUONG', qty: '80', note: DESIGN },
  { gold_type_code: 'ML', uom: 'OZ', qty: '15', note: DESIGN },
  { gold_type_code: 'CS', uom: 'OZ', qty: '28', note: DESIGN },
  { gold_type_code: 'OTH', uom: 'OZ', qty: '1', note: DESIGN },
  { gold_type_code: 'SG', uom: 'GRAM', qty: String(beginWeight('1.Scrap Gold') ?? ''), note: 'scrap.xlsx, 1.Scrap Gold, dòng Begin' },
  { gold_type_code: 'PT', uom: 'GRAM', qty: String(beginWeight('PT Scrap') ?? ''), note: 'scrap.xlsx, PT Scrap, dòng BEGIN' },
  { gold_type_code: 'GRAIN', uom: 'GRAM', qty: '1088.54', note: DESIGN },
].map((r) => ({ as_of: '2026-01-01', unit_cost: '', value: '', ...r }))
writeFileSync(join(OUT, '03-opening-inventory.csv'),
  toCsv(opening, ['as_of', 'gold_type_code', 'uom', 'qty', 'unit_cost', 'value', 'note']), 'utf8')

// ── Bảng tổng kết ───────────────────────────────────────────────────────────
console.table(summary)
const total = (k) => summary.reduce((s, r) => s + r[k], 0)
console.log(`Tổng: ${total('Dòng sheet')} dòng sheet → ${total('Dòng CSV')} dòng CSV ` +
  `(${total('Pickup tách')} Pickup thành hai). Chuyển đổi không khoá: ${total('không khoá')}, ` +
  `trong đó SG/PT chờ lô: ${total('  trong đó SG/PT')}. % vàng gắn được: ${total('% vàng gắn được')}.`)
if (refusedPct.length) console.log(`% vàng ngoài (0, 1], không gắn: ${refusedPct.join(', ')}`)
console.log(`03-opening-inventory.csv: ${opening.length} dòng — SG ${opening[4].qty} g và PT ${opening[5].qty} g đọc từ scrap.xlsx; ` +
  'RP, ML, CS, OTH, GRAIN theo đặc tả, chờ GENERAL REPORT để đối chiếu.')
console.log('02-refining-lots.csv: KHÔNG TẠO — cần BC 201 Sales Report (tab 3.2 PC49 SCRAP GOLD, ' +
  '3.3 MH SCRAP GOLD) trong import-raw/. Thiếu nó thì lot_code để trống và các dòng gửi phân kim bị trả lại.')
