import { describe, it, expect } from 'vitest'
import { t, type MessageKey } from '@/lib/i18n'
import { blockedSentence, describeRefusal } from '@/components/gold/receiptErrors'

const say = (key: MessageKey) => t('vi', key)

describe('a refusal from the books, in the reader’s language', () => {
  it('names the item the payments never reached', () => {
    expect(describeRefusal('PAYMENT_SHORT: item 6 is left with no payment; …', say))
      .toBe(say('receipt.err.paymentShort').replace('{0}', '6'))
  })

  it('names the blocked item and says why', () => {
    expect(describeRefusal('LINE_BLOCKED: item 3 REFINING_SOURCE cannot be changed here', say))
      .toBe('Món 3: Phiếu mua này đã được đưa vào một lô phân kim')
    expect(describeRefusal('LINE_BLOCKED: item 2 SOMETHING_NEW cannot be changed here', say))
      .toBe('Món 2: Không sửa được dòng này ở đây')
  })

  it('translates every receipt-wide refusal', () => {
    expect(describeRefusal('RECEIPT_SINGLE: a deposit …', say)).toBe(say('receipt.err.single'))
    expect(describeRefusal('RECEIPT_SIZE: a receipt holds …', say)).toBe(say('receipt.err.size'))
    expect(describeRefusal('RECEIPT_DIRECTION: every item …', say)).toBe(say('receipt.err.direction'))
    expect(describeRefusal('RECEIPT_QTY: item 4 has no quantity', say)).toBe('Món 4 chưa có số lượng.')
    expect(describeRefusal('RECEIPT_VOIDED: this receipt …', say)).toBe(say('txn.blocked.VOIDED'))
    expect(describeRefusal('CONFLICT: somebody else changed …', say)).toBe(say('receipt.err.conflict'))
  })

  it('keeps the two refusals the single form already translated', () => {
    expect(describeRefusal('DEPOSIT is not a valid movement for Scrap Gold: no such flow rule', say))
      .toContain('quy tắc luồng vàng')
    expect(describeRefusal('transaction x produced no journal lines; it has no payments recorded', say))
      .toBe(say('txn.err.noPayments'))
  })

  it('passes anything else through as it came', () => {
    expect(describeRefusal('the period 2019-10 is closed', say)).toBe('the period 2019-10 is closed')
  })

  it('has no sentence for an item nothing blocks', () => {
    expect(blockedSentence(null, say)).toBeNull()
  })
})
