// Một dòng của tab "PC49 Sale MM.2026" thành dòng CSV mà bộ nạp đọc.
//
// Hàm thuần, như sheet-map.mjs: không đọc tệp, không gọi mạng. Bộ phiên dịch
// (scripts/sheet-to-import.mjs) lo phần đọc; ở đây chỉ có ba việc kế hoạch giao
// cho bộ phiên dịch — tách Pickup, đặt khoá quy đổi, giữ lại chữ của sheet — và
// chúng đủ tế nhị để cần test riêng. Mọi phán xét còn lại nằm trong SQL.

import {
  GOLD_TYPE, UOM, TXN_TYPE, GRAM_PER, excelDate, money, salesNames, paymentSpec,
} from './sheet-map.mjs'

/** Cột của tệp giao dịch, đúng thứ tự kế hoạch đặt. */
export const TXN_COLUMNS = [
  'txn_date', 'txn_type', 'gold_type_code', 'uom', 'qty', 'unit_price', 'amount',
  'partner_code', 'sales', 'scrap_detail', 'gold_pct', 'payments', 'conv_key',
  'lot_code', 'deposit_key', 'remarks',
]

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

// Tiêu đề nằm ở hai hàng: hàng 3 đặt tên nhóm ("AP", "AR_Deposit"), hàng 4 đặt
// tên từng cột tiền ("PO 1", "Amount-1st"). Ghép hai hàng lại mới đọc được.
const HEADINGS = {
  date: ['Date', /^Date$/],
  doc: ['Document N.', /^Document/],
  sales: ['Sales Person', /^Sales Person/],
  customer: ['Customer name', /^Customer/],
  desc: ['Description', /^Description/],
  detail: ['Detail-scrap gold', /^Detail/],
  unit: ['Unit', /^Unit$/],
  qty: ['Qty', /^Qty$/],
  price: ['Unit Price', /^Unit Price$/],
  amount: ['Amount', /^Amount$/],
  type: ['Type', /^Type$/],
  po1: ['PO 1', /PO 1$/],
  po2: ['PO 2', /PO 2$/],
  s1: ['Sales-1st', /Sales-1st$/],
  s2: ['Sales-2nd', /Sales-2nd$/],
  a1: ['Amount-1st', /Amount-1st$/],
  a2: ['Amount-2nd', /Amount-2nd/],
  pickupDate: ['Pickup Date', /^Pickup Date$/],
  remarks: ['Remarks', /^Remarks$/],
}

const MONEY_COLUMNS = ['po1', 'po2', 's1', 's2', 'a1', 'a2']

/**
 * Vị trí từng cột, tìm theo chữ tiêu đề.
 *
 * Tab tháng 4 lệch trái một cột so với các tháng khác. Đọc theo chữ cái cột thì
 * số lượng tháng 4 thành đơn giá mà không ai hay; nên tìm theo tên, và thiếu
 * một tên thì dừng lại nói tên đó chứ không đoán.
 *
 * @returns {Record<string, number>}
 */
export function locateColumns(rows) {
  const top = rows[2] ?? []
  const bottom = rows[3] ?? []
  const width = Math.max(top.length, bottom.length)
  const text = Array.from({ length: width }, (_, i) => norm(`${top[i] ?? ''} ${bottom[i] ?? ''}`))

  const at = {}
  for (const [key, [label, pattern]] of Object.entries(HEADINGS)) {
    const i = text.findIndex((t) => pattern.test(t))
    if (i < 0) throw new Error(`no column headed "${label}"`)
    at[key] = i
  }
  // Hình thức trả nằm ngay bên phải cột tiền của nó, ở mọi tab đã xem. Nếu có
  // tab nào khác đi thì phải biết, vì gán nhầm hình thức là ghi sai sổ quỹ.
  for (const key of MONEY_COLUMNS) {
    if (!/method/i.test(text[at[key] + 1] ?? '')) {
      throw new Error(`the column after "${HEADINGS[key][0]}" is not a payment method`)
    }
  }
  return at
}

/** Các dòng có ngày của một tab, đọc ra thành bản ghi phẳng. */
export function readTab(rows) {
  const c = locateColumns(rows)
  const records = []
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i] ?? []
    if (typeof r[c.date] !== 'number' || !excelDate(r[c.date])) continue
    const cell = (k) => (typeof r[c[k]] === 'number' ? r[c[k]] : norm(r[c[k]]))
    const pay = {}
    for (const k of MONEY_COLUMNS) pay[k] = { amount: cell(k), method: norm(r[c[k] + 1]) }
    records.push({
      sheetRow: i + 1,
      date: excelDate(r[c.date]),
      doc: norm(r[c.doc]),
      sales: norm(r[c.sales]),
      customer: norm(r[c.customer]),
      desc: norm(r[c.desc]),
      detail: norm(r[c.detail]),
      unit: norm(r[c.unit]),
      qty: cell('qty'),
      price: cell('price'),
      amount: cell('amount'),
      type: norm(r[c.type]),
      pickupDate: excelDate(r[c.pickupDate]),
      remarks: norm(r[c.remarks]),
      pay,
    })
  }
  return records
}

/** Một con số thành chữ cho CSV; ô trống vẫn là ô trống. */
function figure(value) {
  const n = money(value)
  return n === null ? '' : String(n)
}

// Với các loại này ô khách là câu kế toán viết về dòng đó ("Send to assay",
// "Transfer 1L vàng 9999 ra 37.5gr vàng Grain"), không phải một khách hàng.
// Đặc tả chốt: nội dung ô đi vào ghi chú, không sinh ra một đối tác không có thật.
const NOTE_TYPES = new Set(['TRANSFER_IN', 'TRANSFER_OUT', 'RA_RP', 'MEMO'])

/**
 * Một dòng sheet thành một hoặc hai dòng CSV.
 *
 * Pickup thành hai: phiếu cọc ngày của dòng, rồi phiếu giao hàng ngày ở cột
 * Pickup Date. Cả hai mang dấu của phiếu bán — record_inventory_movement trừ kệ
 * theo dấu của phiếu cọc, nên số lượng dương sẽ đặt lại lên kệ đúng lượng vàng
 * vừa bán. Phiếu cọc không có doanh thu (amount 0); phiếu giao hàng mang cả giá.
 */
export function toImportRows(record) {
  const gold = record.desc ? (GOLD_TYPE[record.desc] ?? record.desc) : ''
  let uom = ''
  if (record.unit) {
    uom = UOM[record.unit]
    if (!uom) throw new Error(`sheet row ${record.sheetRow}: no reading for Unit "${record.unit}"`)
  }
  const qty = Number(record.qty)

  const base = (txnType) => {
    const note = NOTE_TYPES.has(txnType)
    const remarks = [
      record.doc ? `Chứng từ gốc ${record.doc}` : '',
      note ? record.customer : '',
      record.remarks,
    ].filter(Boolean).join(' · ')
    return {
      txn_date: record.date,
      txn_type: txnType,
      gold_type_code: gold,
      uom,
      qty: figure(record.qty),
      unit_price: figure(record.price),
      amount: figure(record.amount),
      partner_code: note ? '' : record.customer,
      sales: salesNames(record.sales).join('/'),
      scrap_detail: record.detail,
      gold_pct: record.goldPct ?? '',
      payments: '',
      conv_key: '',
      lot_code: '',
      deposit_key: '',
      remarks,
    }
  }
  const pay = (direction, ...keys) =>
    paymentSpec(keys.map((k) => ({ direction, ...record.pay[k] })))

  if (record.type === 'Pickup') {
    if (!record.pickupDate) {
      throw new Error(`sheet row ${record.sheetRow}: a Pickup with no Pickup Date`)
    }
    const key = `dep-${record.date}-${record.sheetRow}`
    const sold = String(-Math.abs(qty))
    return [
      { ...base('DEPOSIT'), qty: sold, amount: '0', payments: pay('AR', 'a1'), deposit_key: key },
      { ...base('PICKUP'), txn_date: record.pickupDate, qty: sold,
        payments: pay('AR', 'a2'), deposit_key: key },
    ]
  }

  const txnType = record.type === 'Transfer'
    ? (qty > 0 ? 'TRANSFER_IN' : 'TRANSFER_OUT')
    : TXN_TYPE[record.type]
  if (!txnType) {
    throw new Error(`sheet row ${record.sheetRow}: no reading for Type "${record.type}"`)
  }

  const row = base(txnType)
  if (txnType === 'PO' || txnType === 'PO_VENDOR') row.payments = pay('AP', 'po1', 'po2')
  if (txnType === 'SALE') row.payments = pay('AR', 's1', 's2')
  return [row]
}

const CONVERSION_TYPES = new Set(['TRANSFER_IN', 'TRANSFER_OUT', 'RA_RP'])
const REFINED = new Set(['SG', 'PT'])
const TOLERANCE_GRAM = 0.5

/**
 * Đặt khoá quy đổi cho các ngày cân được trọng lượng.
 *
 * Sheet ghi một lần đổi vàng thành nhiều dòng rời trong cùng một ngày. Chỉ khi
 * cả ngày cộng lại bằng không (sai số dưới nửa gram) mới coi đó là một phiên
 * quy đổi. Ngày lệch không có khoá, và bộ nạp trả lại để kế toán soát: đoán ở
 * đây là tự dựng một phiên quy đổi chưa từng xảy ra. Vàng vụn và bạch kim
 * không vào đây — chúng đi gửi phân kim và thuộc về một lô.
 *
 * @param {Array<Record<string, string>>} rows
 * @returns {Array<Record<string, string>>}
 */
export function assignConversionKeys(rows) {
  const days = new Map()
  for (const row of rows) {
    if (!CONVERSION_TYPES.has(row.txn_type) || REFINED.has(row.gold_type_code) || row.lot_code) continue
    days.set(row.txn_date, [...(days.get(row.txn_date) ?? []), row])
  }
  for (const [date, group] of days) {
    if (group.length < 2) continue
    const grams = group.reduce((sum, r) => sum + Number(r.qty) * (GRAM_PER[r.uom] ?? NaN), 0)
    if (Math.abs(grams) < TOLERANCE_GRAM) {
      for (const r of group) r.conv_key = `${date}#1`
    }
  }
  return rows
}

// Hai dòng là một khi mọi ô đều giống nhau. deposit_key không tính: nó được dựng
// từ số hàng trong sheet, nên hai bản chép của cùng một phiếu cọc không chung khoá.
const sameRow = (a, b) => TXN_COLUMNS.every((c) => c === 'deposit_key' || a[c] === b[c])

/**
 * Bỏ những dòng mà kế toán chép sang tab tháng sau.
 *
 * Mười lăm dòng của sheet 2026 có mặt hai lần: ở tab của chính ngày đó và, giống
 * từng ô, ở tab tháng kế — phiếu cọc chưa giao, phiếu bán chưa thu, giữ lại cho
 * dễ theo dõi. Nạp từng tab như đã viết là ghi sổ mỗi phiếu hai lần.
 *
 * Chỉ bỏ khi chắc là bản chép: dòng mang ngày của một tab KHÁC, và tab đó có một
 * dòng giống hệt. Dòng ghi muộn không có bản gốc thì giữ, vì không nơi nào khác
 * ghi nó. Bản chép khác đi dù một ô — chẳng hạn đã điền tiền thu — cũng giữ, vì
 * đó là việc cần người xem. Hai dòng giống nhau trong cùng một tab thì không bao
 * giờ bỏ: hai khách mua cùng một đồng xu cùng ngày cùng giá là chuyện thường.
 * Phiếu cọc bị bỏ thì phiếu giao hàng đi kèm nó trong tab đó bị bỏ theo.
 *
 * @param {Record<string, Array<Record<string, string>>>} tabs
 * @returns {{ tabs: Record<string, Array<Record<string, string>>>,
 *             dropped: Array<{ tab: string, from: string, row: Record<string, string> }> }}
 */
export function dropCarriedOver(tabs) {
  const kept = {}
  const dropped = []
  for (const [tab, rows] of Object.entries(tabs)) {
    const gone = new Set()
    for (const row of rows) {
      if (row.txn_type === 'PICKUP') continue
      const from = row.txn_date.slice(5, 7)
      if (from === tab || !tabs[from]) continue
      if (!tabs[from].some((original) => sameRow(original, row))) continue
      gone.add(row)
      dropped.push({ tab, from, row })
      if (row.txn_type === 'DEPOSIT' && row.deposit_key) {
        for (const pickup of rows) {
          if (pickup.txn_type === 'PICKUP' && pickup.deposit_key === row.deposit_key) {
            gone.add(pickup)
            dropped.push({ tab, from, row: pickup })
          }
        }
      }
    }
    kept[tab] = rows.filter((r) => !gone.has(r))
  }
  return { tabs: kept, dropped }
}

/** CSV, với dấu ngoặc kép cho ô có dấu phẩy, ngoặc kép hay xuống dòng. */
export function toCsv(rows, columns) {
  const field = (v) => {
    const s = String(v ?? '')
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.join(',')]
  for (const row of rows) lines.push(columns.map((c) => field(row[c])).join(','))
  return `${lines.join('\n')}\n`
}
