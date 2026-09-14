// Bảng tra giữa chữ trong bảng tính và tên trong hệ thống.
//
// Cố ý là các hàm thuần: không đọc tệp, không gọi mạng, không phán xét. Nhờ vậy
// nó chạy được trong test, và mọi quyết định "chữ này nghĩa là gì" nằm đúng một
// chỗ thay vì rải khắp bộ chuyển đổi.

/** Cột Description của sheet giao dịch, và mã loại vàng tương ứng. */
export const GOLD_TYPE = {
  'Rong Phung': 'RP',
  '9999': '9999',
  'Maple Leaf': 'ML',
  'Credit Suisse': 'CS',
  'American Eagle': 'AE',
  'Other': 'OTH',
  'Scrap gold': 'SG',
  'Grain': 'GRAIN',
  'PT': 'PT',
}

export const UOM = { 'Lượng': 'LUONG', 'Oz': 'OZ', 'Gram': 'GRAM' }

/** Cột Type. Transfer tách thành vào/ra theo dấu số lượng, nên không có ở đây. */
export const TXN_TYPE = {
  'PO': 'PO',
  'PO(Vendor)': 'PO_VENDOR',
  'Sale': 'SALE',
  'Memo': 'MEMO',
  'Ra RP': 'RA_RP',
}

export const METHOD = {
  'Cash': 'CASH', 'Check': 'CHECK', 'Zelle': 'ZELLE', 'Bank wire': 'BANKWIRE',
}

/**
 * Số gram của một đơn vị, để cộng một ngày chuyển đổi xem có cân không.
 *
 * Khối lượng, nên là 31,105 — đúng như `uom_factor` và `src/lib/domain/units.ts`.
 * 31,1 là số chia khi ĐỊNH GIÁ; dùng nó để cân thì mỗi ounce lệch 0,005 g.
 */
export const GRAM_PER = { LUONG: 37.5, OZ: 31.105, GRAM: 1 }

const DAY = 86_400_000
// Excel đếm ngày từ 30-12-1899, và cố ý đếm nhầm 1900 là năm nhuận; mốc này là
// mốc đã tính cả cái nhầm đó.
const EPOCH = Date.UTC(1899, 11, 30)

/** Số thứ tự ngày của bảng tính thành ngày ISO. Ô rỗng hay chữ trả về null. */
export function excelDate(value) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(EPOCH + Math.floor(n) * DAY).toISOString().slice(0, 10)
}

/**
 * Số tiền, dù ô chứa số hay chứa chữ của số.
 *
 * Bảng tính viết số âm bằng ngoặc đơn, và viết "-" cho ô trống. Dấu lỗi công
 * thức thì trả về null: bảng tính cũng không biết đáp án, nên đây cũng không.
 */
export function money(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const raw = String(value ?? '').trim()
  if (!raw || raw === '-' || raw.startsWith('#')) return null
  const negative = raw.startsWith('(') || raw.startsWith('-')
  const digits = raw.replace(/[^0-9.]/g, '')
  if (!digits) return null
  const n = Number(digits)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/** Các tên trong ô sales, theo đúng thứ tự viết. */
export function salesNames(cell) {
  return String(cell ?? '')
    .split(/[/,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Ô thanh toán của bộ nạp: `AP:CASH:400|AP:CHECK:250`.
 *
 * Số 0 và ô thiếu hình thức bị bỏ: một dòng thanh toán bằng 0 không phải là
 * việc đã xảy ra, và một khoản tiền không nói trả bằng gì thì hệ thống không
 * ghi sổ được — để bộ nạp trả lại còn hơn đoán là tiền mặt.
 */
export function paymentSpec(entries) {
  return entries
    .map(({ direction, method, amount }) => {
      const value = money(amount)
      const code = METHOD[String(method ?? '').trim()]
      if (!value || !code) return null
      return `${direction}:${code}:${Math.abs(value)}`
    })
    .filter(Boolean)
    .join('|')
}

// Cột "Customer name/Vendor" kiêm luôn ô ghi chú cho các dòng chuyển đổi.
const NOTE_WORDS = /(send to|assay|transfer|gởi|gửi|chuyển|đổi|ra rp|bán nội bộ)/i

/** Ô khách này thật ra là câu ghi chú kế toán viết về một dòng chuyển đổi. */
export function isNoteNotCustomer(cell) {
  const s = String(cell ?? '').trim()
  return Boolean(s) && NOTE_WORDS.test(s)
}
