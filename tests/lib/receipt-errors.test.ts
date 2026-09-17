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

  it('says what is wrong with a later payment', () => {
    expect(describeRefusal('SETTLEMENT_OVER: owed 3361.00 paid 4000.00', say))
      .toBe('Số tiền 4,000.00 lớn hơn số còn nợ 3,361.00.')
    expect(describeRefusal('SETTLEMENT_DATE: receipt 2026-06-02, paid 2026-06-01; …', say))
      .toBe('Ngày trả không được trước ngày của phiếu (2026-06-02).')
    expect(describeRefusal('SETTLEMENT_PERIOD: 2026-11 is closed; …', say))
      .toBe('Tháng 2026-11 đã khoá sổ. Chọn ngày trả trong tháng còn mở.')
    expect(describeRefusal('SETTLEMENT_KIND: only a purchase …', say)).toBe(say('settle.err.kind'))
    expect(describeRefusal('SETTLEMENT_AMOUNT: a payment …', say)).toBe(say('settle.err.amount'))
    expect(describeRefusal('SETTLEMENT_OLD_POSTING: this purchase …', say)).toBe(say('settle.err.oldPosting'))
    expect(describeRefusal('SETTLEMENT_VOIDED: this payment …', say)).toBe(say('settle.err.voided'))
    expect(describeRefusal('RECEIPT_HAS_SETTLEMENTS: 2 later payment(s) …', say))
      .toBe(say('receipt.err.hasSettlements').replace('{0}', '2'))
  })

  it('says what is wrong with a pickup', () => {
    expect(describeRefusal('PICKUP_NOT_DEPOSIT: only a deposit …', say)).toBe(say('pickup.err.notDeposit'))
    expect(describeRefusal('PICKUP_TAKEN: 2026-06-10; this deposit …', say))
      .toBe(say('pickup.err.taken').replace('{0}', '2026-06-10'))
    expect(describeRefusal('PICKUP_DATE: deposit 2026-06-02, picked up …', say))
      .toBe(say('pickup.err.date').replace('{0}', '2026-06-02'))
    expect(describeRefusal('PICKUP_NO_PRICE: nobody recorded …', say)).toBe(say('pickup.err.noPrice'))
  })

  it('passes anything else through as it came', () => {
    expect(describeRefusal('the period 2019-10 is closed', say)).toBe('the period 2019-10 is closed')
  })

  it('has no sentence for an item nothing blocks', () => {
    expect(blockedSentence(null, say)).toBeNull()
  })
})
