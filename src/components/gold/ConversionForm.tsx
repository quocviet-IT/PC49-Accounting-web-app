'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, AutoComplete, Button, Col, Form, Input, InputNumber, Modal, Row, Select,
} from 'antd'
import { Check, ListPlus, Plus, Trash2, X } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import type { Uom } from '@/lib/domain/units'
import {
  correctConversion, saveConversion, type SaveResult,
} from '@/app/(app)/gold-transactions/actions'
import type { GoldTypeOption, ReceiptRow } from './types'
import {
  MAX_CONVERSION_LINES, RA_RP_GOLD, balanceOf, conversionLinePayload, lineGrams,
  sideGoldTypes, sidesFromSaved,
  type ConversionKind, type ConversionLineField, type Side,
} from './conversionLine'
import { describeRefusal } from './receiptErrors'
import { normalizeTransactionSearch } from './transactionFilters'
import styles from './Txn.module.css'

const grams = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
const percent = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Values = {
  convDate: string
  kind: ConversionKind
  partnerCode: string
  note: string
  out: ConversionLineField[]
  in: ConversionLineField[]
  varianceReason: string
  reason: string
}

const SIDES: Side[] = ['out', 'in']
const KINDS: ConversionKind[] = ['TRANSFER', 'RA_RP']

/**
 * One conversion, entered as it happened: the gold that went out and the gold
 * that came in, weighed against each other (spec 2026-09-17, "Quy đổi vàng").
 *
 * The weights are compared as they are typed, in grams whatever the unit, and
 * a difference beyond CONVERSION_WEIGHT_TOLERANCE_PCT asks for a reason rather
 * than refusing: a melt that came up short has to be recordable as it was.
 *
 * Correcting reuses this form with every leg of the conversion. Nothing is
 * written when it opens; the reversal and the replacement happen together.
 */
export function ConversionForm({
  open, onClose, onSaved, convDate, goldTypes, partners, flowRules, tolerancePct, correcting,
}: {
  open: boolean
  onClose: () => void
  /** Called with the number the conversion was given, and whether the form stays open. */
  onSaved: (docNo: string | null, stayOpen: boolean) => void
  convDate: string
  goldTypes: GoldTypeOption[]
  partners: { code: string; phone: string | null }[]
  /** Which gold may go out and come in on a transfer (gold_flow_rule). */
  flowRules: { gold_type_code: string; txn_type: string }[]
  /** CONVERSION_WEIGHT_TOLERANCE_PCT, as a percent. */
  tolerancePct: number
  /** The conversion being replaced, or null when this is a fresh one. */
  correcting: ReceiptRow | null
}) {
  const { locale, t } = useLocale()
  const [form] = Form.useForm<Values>()
  const [error, setError] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  function requestClose() {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  // Reloading or closing the tab loses what was typed.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    if (error) topRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  /** Stable for the life of one conversion on this form, so saving twice is saving once. */
  const requestKey = useRef<string>(crypto.randomUUID())

  const goldName = (code: string) => {
    const g = goldTypes.find((x) => x.code === code)
    return g ? (locale === 'vi' ? g.name_vi : g.name_en) : code
  }
  const uomOf = (code: string): Uom | '' =>
    goldTypes.find((g) => g.code === code)?.native_uom ?? ''
  const sideName = (side: Side) => t(side === 'out' ? 'conversion.side.out' : 'conversion.side.in')

  const initial: Values = useMemo(() => {
    if (!correcting) {
      return {
        convDate, kind: 'TRANSFER', partnerCode: '', note: '',
        out: [{ goldTypeCode: '', qty: null }], in: [{ goldTypeCode: '', qty: null }],
        varianceReason: '', reason: '',
      }
    }
    const sides = sidesFromSaved(correcting)
    return {
      convDate,
      kind: correcting.conversion?.kind === 'RA_RP' ? 'RA_RP' : 'TRANSFER',
      partnerCode: correcting.partner_code ?? '',
      note: correcting.remarks ?? '',
      out: sides.out.length ? sides.out : [{ goldTypeCode: '', qty: null }],
      in: sides.in.length ? sides.in : [{ goldTypeCode: '', qty: null }],
      varianceReason: correcting.conversion?.varianceReason ?? '',
      // Filled in so correcting is one click (B12). Still editable.
      reason: t('txn.correctReason'),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correcting])

  const kind = (Form.useWatch('kind', form) ?? initial.kind) as ConversionKind
  const outLines = (Form.useWatch('out', form) ?? []) as (ConversionLineField | undefined)[]
  const inLines = (Form.useWatch('in', form) ?? []) as (ConversionLineField | undefined)[]
  const gramsOf = (l: ConversionLineField | undefined) => lineGrams(uomOf(l?.goldTypeCode ?? ''), l?.qty)
  const balance = balanceOf(outLines.map(gramsOf), inLines.map(gramsOf), tolerancePct)
  const weighed = balance.out > 0 && balance.in > 0
  const needsReason = weighed && !balance.within

  /** Ra RP fixes the gold on both sides; a transfer leaves what was chosen. */
  function kindChosen(next: ConversionKind) {
    if (next !== 'RA_RP') return
    for (const side of SIDES) {
      const lines = (form.getFieldValue(side) ?? []) as ConversionLineField[]
      form.setFieldValue(side, lines.map((l) => ({ ...l, goldTypeCode: RA_RP_GOLD[side] })))
    }
  }

  async function submit(stayOpen: boolean) {
    setError(null)
    setLastSaved(null)
    try {
      await form.validateFields()
    } catch {
      setValidationError(true)
      topRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }
    const v = form.getFieldsValue(true) as Values

    const body = {
      requestKey: requestKey.current,
      convDate: v.convDate,
      kind: v.kind,
      partnerCode: v.partnerCode?.trim() || null,
      note: v.note?.trim() || null,
      // Only when the weights call for one: a reason left over from a
      // difference since typed away is not the record's.
      varianceReason: needsReason ? (v.varianceReason?.trim() || null) : null,
      out: (v.out ?? []).map((l) => conversionLinePayload(uomOf(l.goldTypeCode) as Uom, l)),
      in: (v.in ?? []).map((l) => conversionLinePayload(uomOf(l.goldTypeCode) as Uom, l)),
    }

    setSaving(true)
    const result = await settleAction((): Promise<SaveResult> => (correcting
      ? correctConversion({
          ...body,
          original: correcting.key,
          expectedRevision: correcting.revision,
          reason: v.reason,
        })
      : saveConversion(body)))
    setSaving(false)

    if (!result.ok) {
      setError(isThrew(result) ? describeThrew(result, t) : describeRefusal(result.message, t))
      topRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }

    if (stayOpen && !correcting) {
      // The next conversion: the same day, everything else fresh, a fresh key.
      requestKey.current = crypto.randomUUID()
      form.resetFields()
      form.setFieldValue('convDate', v.convDate)
      setDirty(false)
      setLastSaved(result.docNo)
      onSaved(result.docNo, true)
      return
    }
    setDirty(false)
    onSaved(result.docNo, false)
  }

  return (
    <Modal
      open={open}
      width={1040}
      title={t(correcting ? 'conversion.correctTitle' : 'conversion.title')}
      onCancel={requestClose}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="close" icon={<X size={16} aria-hidden />} onClick={requestClose}>
          {t('txn.form.close')}
        </Button>,
        !correcting && (
          <Button key="more" icon={<ListPlus size={16} aria-hidden />} loading={saving}
                  onClick={() => submit(true)}>
            {t('conversion.saveMore')}
          </Button>
        ),
        <Button key="save" type="primary" icon={<Check size={16} aria-hidden />} loading={saving}
                onClick={() => submit(false)}>
          {t('txn.save')}
        </Button>,
      ]}
    >
      <Form<Values> form={form} layout="vertical" initialValues={initial}
                    className={styles.form} scrollToFirstError
                    onValuesChange={() => { setDirty(true); setValidationError(false) }}>
        <div ref={topRef} />
        {validationError && (
          <Alert type="error" showIcon role="alert" title={t('txn.form.checkFields')} />
        )}
        {error && (
          <Alert type="error" showIcon title={t('txn.rowError')} description={error}
                 style={{ marginBottom: 12 }} />
        )}
        {lastSaved && (
          <Alert type="success" showIcon style={{ marginBottom: 12 }}
                 title={`${t('txn.form.savedAs')} ${lastSaved}`} />
        )}

        {correcting && (
          <section className={styles.section} aria-labelledby="conv-correction-heading">
            <h3 id="conv-correction-heading" className={styles.sectionHeading}>
              {t('txn.form.correction')}
            </h3>
            <Form.Item
              name="reason"
              label={t('txn.form.reason')}
              extra={t('txn.form.reasonHint')}
              rules={[{ required: true, min: 3, message: t('txn.form.required') }]}
            >
              <Input />
            </Form.Item>
          </section>
        )}

        <section className={styles.section} aria-labelledby="conv-details-heading">
          <h3 id="conv-details-heading" className={styles.sectionHeading}>
            {t('txn.form.details')}
          </h3>
          <Row gutter={12}>
            <Col xs={24} sm={6}>
              {/* A correction keeps the day of the conversion it replaces. */}
              <Form.Item name="convDate" label={t('txn.date')}
                         rules={[{ required: true, message: t('txn.form.required') }]}>
                <Input type="date" disabled={Boolean(correcting)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={6}>
              <Form.Item name="kind" label={t('conversion.kind')}>
                <Select
                  options={KINDS.map((k) => ({
                    value: k,
                    label: t(k === 'RA_RP' ? 'conversion.kind.RA_RP' : 'conversion.kind.TRANSFER'),
                  }))}
                  onChange={kindChosen}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="partnerCode" label={t('txn.col.partner')}>
                <AutoComplete
                  options={partners.map((p) => ({ value: p.code }))}
                  filterOption={(input, option) =>
                    normalizeTransactionSearch(option?.value)
                      .includes(normalizeTransactionSearch(input))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="note" label={t('txn.col.remarks')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </section>

        <section className={styles.section} aria-labelledby="conv-lines-heading">
          <h3 id="conv-lines-heading" className={styles.sectionHeading}>{t('conversion.title')}</h3>
          <span className={styles.sectionDescription}>
            {t('conversion.hint')} {kind === 'RA_RP' ? t('conversion.raRpHint') : ''}
          </span>
          <Row gutter={16}>
            {SIDES.map((side) => {
              const lines = side === 'out' ? outLines : inLines
              const choices = sideGoldTypes(flowRules, kind, side)
                .map((code) => ({ value: code, label: goldName(code) }))
              return (
                <Col xs={24} md={12} key={side}>
                  <h4 className={styles.lineNo}>{t(side === 'out' ? 'conversion.out' : 'conversion.in')}</h4>
                  <Form.List name={side}>
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map((field, index) => {
                          const line = lines[index]
                          const uom = uomOf(line?.goldTypeCode ?? '')
                          const label = `${sideName(side)} ${index + 1}`
                          return (
                            <div key={field.key} className={styles.line} role="group" aria-label={label}>
                              <div className={styles.lineHead}>
                                <span className={styles.lineNo}>{label}</span>
                                <Button type="text" danger size="small"
                                        icon={<Trash2 size={16} aria-hidden />}
                                        aria-label={t('conversion.removeLine')}
                                        disabled={fields.length === 1}
                                        onClick={() => remove(field.name)} />
                              </div>
                              <Row gutter={8}>
                                <Col xs={24} sm={10}>
                                  <Form.Item name={[field.name, 'goldTypeCode']} label={t('txn.col.gold')}
                                             rules={[{ required: true, message: t('txn.form.required') }]}>
                                    <Select showSearch optionFilterProp="label" options={choices}
                                            disabled={kind === 'RA_RP'} />
                                  </Form.Item>
                                </Col>
                                <Col xs={14} sm={8}>
                                  <Form.Item
                                    name={[field.name, 'qty']}
                                    label={t('txn.col.qty')}
                                    rules={[
                                      { required: true, message: t('txn.form.required') },
                                      {
                                        validator: (_, value) => (Number(value) === 0
                                          ? Promise.reject(new Error(t('txn.form.qtyZero')))
                                          : Promise.resolve()),
                                      },
                                    ]}
                                  >
                                    <InputNumber style={{ width: '100%' }} min={0} step={0.01}
                                                 controls={false} suffix={uom || undefined} />
                                  </Form.Item>
                                </Col>
                                <Col xs={10} sm={6}>
                                  <Form.Item label={t('txn.col.grams')}>
                                    <output className={styles.fine}>{grams.format(gramsOf(line))}</output>
                                  </Form.Item>
                                </Col>
                              </Row>
                            </div>
                          )
                        })}
                        {fields.length < MAX_CONVERSION_LINES && (
                          <Button type="dashed" block className={styles.addLine}
                                  icon={<Plus size={16} aria-hidden />}
                                  onClick={() => add({
                                    goldTypeCode: kind === 'RA_RP' ? RA_RP_GOLD[side] : '', qty: null,
                                  })}>
                            {t(side === 'out' ? 'conversion.addOut' : 'conversion.addIn')}
                          </Button>
                        )}
                      </>
                    )}
                  </Form.List>
                </Col>
              )
            })}
          </Row>

          <div className={styles.calculatedAmount} aria-live="polite">
            <span>
              {t('conversion.balance')
                .replace('{0}', grams.format(balance.out))
                .replace('{1}', grams.format(balance.in))
                .replace('{2}', grams.format(balance.diff))
                .replace('{3}', balance.pct === null ? '—' : percent.format(balance.pct))}
            </span>
            {weighed && (
              <strong className={balance.within ? 'pc-in' : 'pc-out'}>
                {balance.within
                  ? t('conversion.balanced')
                  : t('conversion.overTolerance').replace('{0}', String(tolerancePct))}
              </strong>
            )}
          </div>

          {needsReason && (
            <Form.Item name="varianceReason" label={t('conversion.varianceReason')}
                       style={{ marginTop: 12 }}
                       rules={[{ required: true, whitespace: true, message: t('txn.form.required') }]}>
              <Input />
            </Form.Item>
          )}
        </section>
      </Form>

      <Modal
        open={confirmClose}
        title={t('txn.form.unsavedTitle')}
        okText={t('txn.form.discard')}
        okButtonProps={{ danger: true }}
        cancelText={t('txn.form.keepEditing')}
        onOk={() => { setConfirmClose(false); setDirty(false); onClose() }}
        onCancel={() => setConfirmClose(false)}
      >
        {t('txn.form.unsavedBody')}
      </Modal>
    </Modal>
  )
}
