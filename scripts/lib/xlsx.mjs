// Đọc một tệp .xlsx mà không cần thư viện ngoài.
//
// Một tệp xlsx là một tệp ZIP chứa vài tệp XML. Node có sẵn `zlib` để bung
// deflate, còn phần đọc mục lục ZIP thì ngắn — nên cả bộ đọc này gói gọn trong
// một tệp, không thêm phụ thuộc nào vào một repo công khai. Bản `xlsx` trên npm
// đã lâu không cập nhật và mang lỗ hổng đã công bố; đổi lấy sáu mươi dòng ở đây
// là một cái giá tốt.
//
// Bộ đọc này cố ý ngu: nó trả về đúng thứ ô chứa — chuỗi là chuỗi, số là số.
// Ngày tháng trong xlsx là số thứ tự ngày, và bộ nào biết cột nào là ngày thì
// bộ đó tự đổi (xem `excelDate` trong sheet-map.mjs). Đoán kiểu ở tầng này là
// chỗ những con số như "0106" biến thành ngày mà không ai yêu cầu.

import { inflateRawSync } from 'node:zlib'

/** Bung một tệp ZIP trong bộ nhớ thành bảng tên → nội dung. */
export function unzip(buf) {
  // Mục lục trung tâm nằm ở cuối tệp, sau một bản ghi EOCD có chữ ký PK\5\6.
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('không thấy mục lục ZIP; tệp này không phải xlsx')

  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const files = new Map()

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('mục lục ZIP hỏng')
    const method = buf.readUInt16LE(at + 10)
    const sizeC = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const localAt = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)

    // Phần đầu cục bộ có độ dài tên và extra riêng, thường khác mục lục.
    const lNameLen = buf.readUInt16LE(localAt + 26)
    const lExtraLen = buf.readUInt16LE(localAt + 28)
    const from = localAt + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(from, from + sizeC)
    files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))

    at += 46 + nameLen + extraLen + commentLen
  }
  return files
}

const ENTITY = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const unescapeXml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,
  (_, e) => ENTITY[e] ?? String.fromCodePoint(
    e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)))

/** Cột "BC" là cột thứ 55. */
function columnIndex(ref) {
  let n = 0
  for (const ch of ref) {
    if (ch >= '0' && ch <= '9') break
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

/** Gộp mọi <t> trong một phần tử chuỗi chia sẻ (chuỗi có định dạng bị cắt nhỏ). */
function textOf(xml) {
  let out = ''
  for (const m of xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) out += m[1]
  return unescapeXml(out)
}

function sharedStrings(files) {
  const xml = files.get('xl/sharedStrings.xml')
  if (!xml) return []
  return [...xml.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
}

// Cả hàng lẫn ô đều có thể tự đóng khi rỗng: `<row r="5" .../>`, `<c r="H3"/>`.
// Một mẫu tìm kiếm chỉ biết dạng "có nội dung" sẽ để hàng rỗng nuốt luôn hàng
// đứng sau nó cho tới `</row>` kế tiếp — nội dung gắn nhầm số hàng, và cả bảng
// lệch đi mà không báo lỗi. Nên cả hai đều thử dạng tự đóng trước.
const ROW = /<row(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/row>)/g
const CELL = /<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g

function parseSheet(xml, strings) {
  const rows = []
  for (const rm of xml.matchAll(ROW)) {
    const rowNo = Number(/r="(\d+)"/.exec(rm[1] ?? '')?.[1] ?? 0) - 1
    if (rowNo < 0) continue
    const cells = []
    for (const cm of (rm[2] ?? '').matchAll(CELL)) {
      const attrs = cm[1] ?? ''
      const body = cm[2] ?? ''
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)
      const col = ref ? columnIndex(ref[1]) : cells.length
      const type = /t="([^"]+)"/.exec(attrs)?.[1]
      const vm = /<v>([\s\S]*?)<\/v>/.exec(body)

      let value = ''
      if (type === 's') value = strings[Number(vm?.[1] ?? -1)] ?? ''
      else if (type === 'inlineStr') value = textOf(body)
      else if (type === 'str' || type === 'e') value = unescapeXml(vm?.[1] ?? '')
      else if (vm) value = Number(vm[1])

      cells[col] = value
    }
    rows[rowNo] = cells
  }
  // Hàng và ô trống để lại lỗ trong mảng; lấp lại để chỗ dùng không phải nhớ.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? []
    for (let j = 0; j < row.length; j++) if (row[j] === undefined) row[j] = ''
    rows[i] = row
  }
  return rows
}

/**
 * Đọc cả workbook thành bảng: tên tab → mảng hai chiều.
 *
 * Tên tab lấy từ workbook.xml, còn tệp XML của từng tab thì tra qua bảng quan
 * hệ — thứ tự tệp `sheet1.xml`, `sheet2.xml`… KHÔNG theo thứ tự tab, và tin vào
 * nó là cách đọc nhầm tháng 3 thành tháng 5.
 */
export function readWorkbook(buf) {
  const files = unzip(buf)
  const strings = sharedStrings(files)

  const rels = new Map()
  const relXml = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  for (const m of relXml.matchAll(/<Relationship([^>]*)\/>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1]
    const target = /Target="([^"]+)"/.exec(m[1])?.[1]
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''))
  }

  const bookXml = files.get('xl/workbook.xml').toString('utf8')
  const sheets = new Map()
  for (const m of bookXml.matchAll(/<sheet([^>]*)\/>/g)) {
    const name = unescapeXml(/name="([^"]*)"/.exec(m[1])?.[1] ?? '')
    const rid = /r:id="([^"]+)"/.exec(m[1])?.[1]
    const path = `xl/${rels.get(rid)}`
    const xml = files.get(path)
    sheets.set(name, xml ? parseSheet(xml.toString('utf8'), strings) : [])
  }
  return sheets
}
