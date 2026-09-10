/*
 * What each screen says when a read did not arrive.
 *
 * The rule these enforce is one sentence: a screen may not state a fact it
 * could not read. An empty table is a statement — "no transactions this
 * month", "nothing needs a cost price", "there are no refining lots" — and
 * every one of those is a claim about the business that a failed query has no
 * standing to make.
 *
 * These render the real components rather than testing a flag, because the bug
 * being prevented is a rendering: the reads happen server-side, so a browser
 * check cannot reach them, and asserting on the prop would prove only that the
 * prop exists.
 *
 * Almost every case is written as a pair — failed and not failed — because a
 * check for "the failure text is on screen" passes just as well on a component
 * that shows it always.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const { LocaleProvider } = await import('@/lib/i18n/provider')

/** Vietnamese, because that is what the people using this read. */
const FAILED = 'Không tải được dữ liệu'
const EMPTY = 'Chưa có dữ liệu'

function render(el: ReactElement): string {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale="vi">{el}</LocaleProvider>)
}

/** Text with the tags taken out, so an assertion cannot pass on an attribute. */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
}

describe('cash: each section answers for its own read', async () => {
  const { CashView } = await import('@/components/cash/CashView')
  const base = {
    period: '2026-09', rows: [], unmatched: 0, movements: [], unplaced: [],
    recon: [], loans: [], monthEnd: '2026-09-30',
  }

  it('says the movements could not be read instead of showing none', () => {
    expect(text(render(<CashView {...base} failed={{ movements: true }} />)))
      .toContain(FAILED)
  })

  it('and without a failure an empty month still reads as empty', () => {
    const html = text(render(<CashView {...base} />))
    expect(html).toContain(EMPTY)
    expect(html).not.toContain(FAILED)
  })

  it('does not offer to reconcile accounts whose reconciliation is unknown', () => {
    const rows = [{
      code: 'CASH_USD', displayName: 'Tien mat USD', isClearing: false,
      opening: 0, received: 0, paid: 0, closing: 100,
    }]
    const ok = render(<CashView {...base} rows={rows} mayWrite />)
    const failed = render(<CashView {...base} rows={rows} mayWrite
                                    failed={{ recon: true }} />)
    // The button, not the word: the section heading is "Đối chiếu với sổ US",
    // so a bare substring check passes on a page that never offers the button.
    const button = '>Đối chiếu</button>'
    expect(ok).toContain(button)
    expect(failed).not.toContain(button)
    expect(text(failed)).toContain(FAILED)
  })

  it('keeps the loan section on screen rather than letting it vanish', () => {
    // The section is hidden when there are no loans, which is right — but a
    // read that failed must not use that door. An absent section is
    // indistinguishable from a balance of nothing.
    const heading = 'Vay nội bộ (1388)'
    const quiet = text(render(<CashView {...base} />))
    const failed = text(render(<CashView {...base} failed={{ loans: true }} />))
    expect(quiet).not.toContain(heading)
    expect(failed).toContain(heading)
    expect(failed).toContain(FAILED)
  })

  it('keeps the unplaced queue on screen even when the count read failed', () => {
    expect(text(render(<CashView {...base} failed={{ queue: true }} />)))
      .toContain(FAILED)
  })
})

describe('inventory: a month that could not be read has not got no movements', async () => {
  const { InventoryView } = await import('@/components/gold/InventoryView')
  const base = { rows: [], period: '2026-09', asOf: '2026-09-07', movements: [] }

  it('says so instead of drawing an empty movement table', () => {
    expect(text(render(<InventoryView {...base} movementFailed />))).toContain(FAILED)
  })

  it('and a genuinely quiet month still says it is quiet', () => {
    const html = text(render(<InventoryView {...base} />))
    expect(html).toContain(EMPTY)
    expect(html).not.toContain(FAILED)
  })
})

describe('journal: an unread month is not a month with no entries', async () => {
  const { JournalView } = await import('@/components/journal/JournalView')

  it('says the read failed rather than drawing an empty set of books', () => {
    expect(text(render(<JournalView period="2026-09" entries={[]} loadFailed />)))
      .toContain(FAILED)
  })

  it('and a month with genuinely nothing in it still reads as empty', () => {
    const html = text(render(<JournalView period="2026-09" entries={[]} />))
    expect(html).toContain(EMPTY)
    expect(html).not.toContain(FAILED)
  })
})

describe('refining: a failed list must not invite a second lot', async () => {
  const { RefiningView } = await import('@/components/refining/RefiningView')
  const base = {
    lots: [], shares: [], goldTypes: [], available: [],
    pickedByLot: {}, bandsByLot: {}, linesByLot: {},
  }

  it('withholds "open a lot" when it could not read what is already open', () => {
    // This is the one that costs money: a lot already at the refinery, opened
    // a second time because the screen said there were none.
    const html = render(<RefiningView {...base} lotsFailed />)
    expect(html).not.toContain('Mở lô mới')
    expect(text(html)).toContain(FAILED)
  })

  it('but offers it when there are honestly no lots yet', () => {
    const html = render(<RefiningView {...base} />)
    expect(html).toContain('Mở lô mới')
    expect(text(html)).not.toContain(FAILED)
  })
})

describe('gold entry: a day that did not load is not a blank day', async () => {
  const { TxnScreen } = await import('@/components/gold/TxnScreen')
  const base = {
    txnDate: '2026-09-07', goldTypes: [], salesPeople: [], partners: [],
    existing: [],
  }

  it('shows no grid to type into', () => {
    // A blank grid on a day that has transactions is how the same purchase
    // gets entered twice.
    const html = render(<TxnScreen {...base} loadFailed />)
    expect(html).not.toContain('Thêm giao dịch')
    expect(text(html)).toContain(FAILED)
  })

  it('and keeps the date picker, so the day can be left without a reload', () => {
    expect(render(<TxnScreen {...base} loadFailed />)).toContain('type="date"')
  })

  it('while a day that loaded is still enterable', () => {
    const html = render(<TxnScreen {...base} />)
    expect(html).toContain('Thêm giao dịch')
    expect(text(html)).not.toContain(FAILED)
  })
})

describe('prices: an empty list of uncosted sales is a claim', async () => {
  const { PriceGrid } = await import('@/components/prices/PriceGrid')
  const base = {
    date: '2026-09-07', previous: '2026-09-06', rows: [],
    spot: [{ metal: 'GOLD' as const, perOz: null, perGram: null }],
    uncosted: [],
  }

  it('shows the section and says the read failed', () => {
    expect(text(render(<PriceGrid {...base} failed={{ uncosted: true }} />)))
      .toContain(FAILED)
  })

  it('and hides it when there is genuinely nothing uncosted', () => {
    expect(text(render(<PriceGrid {...base} />))).not.toContain(FAILED)
  })

  it('does not let an unread spot price look like an unset one', () => {
    expect(text(render(<PriceGrid {...base} failed={{ spot: true }} />)))
      .toContain(FAILED)
  })
})

describe('periods: an unread month is not an open month', async () => {
  const { PeriodList } = await import('@/components/settings/PeriodList')
  const rows = [{
    period: '2026-08', closed: false, closedAt: null, note: null,
    posted: 0, draft: 0,
  }]

  it('offers no Close button when the state could not be read', () => {
    const html = render(<PeriodList rows={rows} loadFailed />)
    expect(html).not.toContain('Đóng kỳ')
    expect(text(html)).toContain(FAILED)
  })

  it('and offers it when the month really is open', () => {
    const html = render(<PeriodList rows={rows} />)
    expect(html).toContain('Đóng kỳ')
    expect(text(html)).not.toContain(FAILED)
  })
})

describe('import: no rejected rows means the batch went in clean', async () => {
  const { ImportView } = await import('@/components/import/ImportView')
  const batch = {
    id: 'b1', source: 'XLSX', fileName: 'a.xlsx', rowCount: 10, validCount: 10,
    rejectedCount: 0, committedCount: 10, committedAt: null,
  }
  const base = {
    asOf: '2026-09-07', batches: [batch], selected: batch, rejected: [],
    recon: [],
  }

  it('so a failed read of them says so', () => {
    expect(text(render(<ImportView {...base} loadFailed={{ rejected: true }} />)))
      .toContain(FAILED)
  })

  it('and a failed reconciliation is not silent agreement', () => {
    expect(text(render(<ImportView {...base} loadFailed={{ recon: true }} />)))
      .toContain(FAILED)
  })

  it('while a clean batch that really loaded says nothing failed', () => {
    expect(text(render(<ImportView {...base} />))).not.toContain(FAILED)
  })
})

describe('bank conversion: the tolerance is a rule, not a default', async () => {
  const { ConversionView } = await import('@/components/bank/ConversionView')

  it('refuses to work to a figure it could not read', () => {
    expect(text(render(
      <ConversionView transactions={[]} goldTypes={[]} tolerance={100} loadFailed />)))
      .toContain(FAILED)
  })

  it('and works normally when it could', () => {
    expect(text(render(
      <ConversionView transactions={[]} goldTypes={[]} tolerance={100} />)))
      .not.toContain(FAILED)
  })
})

describe('reports: a report of zeros is a conclusion, not a blank', async () => {
  const { ReportView } = await import('@/components/reports/ReportView')
  const { findReport } = await import('@/lib/domain/reports')
  // The real definition, not a hand-written stand-in: a literal that drifts
  // from the type is a test that stops describing the screen.
  const report = findReport('pnl')!
  const base = {
    report,
    period: '2026-09', date: '2026-09-30', from: '2026-09-01', to: '2026-09-30',
  }

  it('says the read failed rather than printing nothing', () => {
    expect(text(render(<ReportView {...base} data={{ kind: 'failed' }} />)))
      .toContain(FAILED)
  })

  it('and a period with genuinely nothing in it still reads as empty', () => {
    const html = text(render(<ReportView {...base} data={{ kind: 'empty' }} />))
    expect(html).toContain(EMPTY)
    expect(html).not.toContain(FAILED)
  })
})

describe('the report queue: an empty queue means nothing is outstanding', async () => {
  const { FeedbackQueue } = await import('@/components/feedback/FeedbackQueue')
  const base = { rows: [], status: null, counts: {}, canTriage: true }

  it('so a failed read says so instead', () => {
    expect(text(render(<FeedbackQueue {...base} loadFailed />))).toContain(FAILED)
  })

  it('and a queue that is really clear still reads as clear', () => {
    const html = text(render(<FeedbackQueue {...base} />))
    expect(html).toContain(EMPTY)
    expect(html).not.toContain(FAILED)
  })
})

describe('the directory: a failed read must not invite a duplicate colleague', async () => {
  const { UsersView } = await import('@/components/settings/UsersView')

  it('withholds "add a person" when it could not read who is already there', () => {
    const html = render(<UsersView people={[]} meId="me" loadFailed />)
    expect(html).not.toContain('Thêm người')
    expect(text(html)).toContain(FAILED)
  })

  it('but offers it when the directory really did load', () => {
    const html = render(<UsersView people={[]} meId="me" />)
    expect(html).toContain('Thêm người')
    expect(text(html)).not.toContain(FAILED)
  })
})

describe('reference: a catalogue answers for itself alone', async () => {
  const { ReferenceView } = await import('@/components/settings/ReferenceView')
  const base = {
    params: [], goldTypes: [], cashAccounts: [], salesPeople: [],
    partners: [{ code: 'KH01', fullName: 'A', phone: '090', isActive: true }],
    accountCount: 0,
  }

  it('one failing does not take the others down with it', () => {
    const html = render(<ReferenceView {...base} failed={{ salesPeople: true }} />)
    expect(text(html)).toContain(FAILED)
    // The partner that did load is still on screen.
    expect(html).toContain('KH01')
  })

  it('and none failing shows no failure', () => {
    expect(text(render(<ReferenceView {...base} />))).not.toContain(FAILED)
  })
})
