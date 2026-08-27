import { describe, it, expect } from 'vitest'
import { t, missingKeys } from '@/lib/i18n'

describe('i18n', () => {
  it('returns the Vietnamese label', () => {
    expect(t('vi', 'nav.dashboard')).toBe('Tổng quan')
  })

  it('returns the English label', () => {
    expect(t('en', 'nav.dashboard')).toBe('Dashboard')
  })

  it('has an English translation for every Vietnamese key', () => {
    expect(missingKeys()).toEqual([])
  })
})
