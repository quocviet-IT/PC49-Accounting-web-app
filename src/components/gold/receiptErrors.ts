import type { MessageKey } from '@/lib/i18n'

type Translate = (key: MessageKey) => string

/**
 * Why an item cannot be corrected, in the reader's language.
 *
 * The database answers with a code (0071); a code nobody has written a sentence
 * for yet still reads as a refusal rather than as the code itself.
 */
export function blockedSentence(code: string | null, t: Translate): string | null {
  if (!code) return null
  const key = ('txn.blocked.' + code) as MessageKey
  const sentence = t(key)
  return sentence === key ? t('txn.blocked.OTHER') : sentence
}

const cents = (figure: string) =>
  Number(figure).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * A refusal from the books, in words the accountant reads.
 *
 * Each refusal somebody can meet at the counter starts with a code (0074,
 * 0075), and the ones about one item carry its number. Anything without a code
 * passes through as it came rather than being guessed at.
 */
export function describeRefusal(message: string, t: Translate): string {
  // A conversion's refusals (0078, 0079) name a side and a line, or carry the
  // weights, so the sentence can say exactly what to fix.
  const unbalanced = /CONVERSION_UNBALANCED: out ([\d.]+) in ([\d.]+) pct ([\d.]+) tolerance ([\d.]+)/
    .exec(message)
  if (unbalanced) {
    const [, out, into, pct, tolerance] = unbalanced
    return t('conversion.err.unbalanced')
      .replace('{0}', Number(out).toFixed(2))
      .replace('{1}', Number(into).toFixed(2))
      .replace('{2}', Number(pct).toFixed(2))
      .replace('{3}', String(Number(tolerance)))
  }
  const sideName = (side: string) => t(side === 'out' ? 'conversion.side.out' : 'conversion.side.in')
  const legBlocked = /LINE_BLOCKED: (out|in) (\d+) ([A-Z_]+)/.exec(message)
  if (legBlocked) {
    return t('conversion.err.blocked')
      .replace('{0}', sideName(legBlocked[1]))
      .replace('{1}', legBlocked[2])
      .replace('{2}', blockedSentence(legBlocked[3], t) ?? '')
  }
  const legQty = /CONVERSION_QTY: (out|in) (\d+)/.exec(message)
  if (legQty) {
    return t('conversion.err.qty').replace('{0}', sideName(legQty[1])).replace('{1}', legQty[2])
  }
  if (/CONVERSION_SIDES/.test(message)) return t('conversion.err.sides')
  if (/CONVERSION_RA_RP/.test(message)) return t('conversion.err.raRp')
  if (/CONVERSION_REFINING/.test(message)) return t('txn.blocked.REFINING_LEG')
  if (/CONVERSION_VOIDED/.test(message)) return t('txn.blocked.VOIDED')

  // A later payment's refusals (0083) carry the figures and the days to say.
  const over = /SETTLEMENT_OVER: owed ([\d.]+) paid ([\d.]+)/.exec(message)
  if (over) return t('settle.err.over').replace('{0}', cents(over[1])).replace('{1}', cents(over[2]))
  const early = /SETTLEMENT_DATE: receipt (\d{4}-\d{2}-\d{2})/.exec(message)
  if (early) return t('settle.err.date').replace('{0}', early[1])
  const closed = /SETTLEMENT_PERIOD: (\d{4}-\d{2})/.exec(message)
  if (closed) return t('settle.err.period').replace('{0}', closed[1])
  if (/SETTLEMENT_KIND/.test(message)) return t('settle.err.kind')
  if (/SETTLEMENT_AMOUNT/.test(message)) return t('settle.err.amount')
  if (/SETTLEMENT_OLD_POSTING/.test(message)) return t('settle.err.oldPosting')
  if (/SETTLEMENT_VOIDED/.test(message)) return t('settle.err.voided')
  const standing = /RECEIPT_HAS_SETTLEMENTS: (\d+)/.exec(message)
  if (standing) return t('receipt.err.hasSettlements').replace('{0}', standing[1])

  // A pickup's refusals (0087).
  if (/PICKUP_NOT_DEPOSIT/.test(message)) return t('pickup.err.notDeposit')
  const taken = /PICKUP_TAKEN: (\d{4}-\d{2}-\d{2})/.exec(message)
  if (taken) return t('pickup.err.taken').replace('{0}', taken[1])
  const beforeDeposit = /PICKUP_DATE: deposit (\d{4}-\d{2}-\d{2})/.exec(message)
  if (beforeDeposit) return t('pickup.err.date').replace('{0}', beforeDeposit[1])
  if (/PICKUP_NO_PRICE/.test(message)) return t('pickup.err.noPrice')

  const short = /PAYMENT_SHORT: item (\d+)/.exec(message)
  if (short) return t('receipt.err.paymentShort').replace('{0}', short[1])

  const blocked = /LINE_BLOCKED: item (\d+) ([A-Z_]+)/.exec(message)
  if (blocked) {
    return t('receipt.err.blocked')
      .replace('{0}', blocked[1])
      .replace('{1}', blockedSentence(blocked[2], t) ?? '')
  }

  const noQty = /RECEIPT_QTY: item (\d+)/.exec(message)
  if (noQty) return t('receipt.err.qty').replace('{0}', noQty[1])

  if (/RECEIPT_VOIDED/.test(message)) return t('txn.blocked.VOIDED')
  if (/RECEIPT_SINGLE/.test(message)) return t('receipt.err.single')
  if (/RECEIPT_SIZE/.test(message)) return t('receipt.err.size')
  if (/RECEIPT_DIRECTION/.test(message)) return t('receipt.err.direction')
  if (/CONFLICT/.test(message)) return t('receipt.err.conflict')
  if (/no journal lines|no payments recorded/.test(message)) return t('txn.err.noPayments')
  if (/is not a valid movement for .*no such flow rule/.test(message)) return t('txn.err.flowRule')
  return message
}
