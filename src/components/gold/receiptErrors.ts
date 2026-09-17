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
