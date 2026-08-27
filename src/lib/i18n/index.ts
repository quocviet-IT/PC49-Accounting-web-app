import { dictionary } from './dictionary'

export type Locale = 'vi' | 'en'
export type MessageKey = keyof typeof dictionary.vi

export function t(locale: Locale, key: MessageKey): string {
  const table = dictionary[locale] as Record<string, string>
  return table[key] ?? (dictionary.vi as Record<string, string>)[key] ?? key
}

export function missingKeys(): MessageKey[] {
  const en = dictionary.en as Record<string, string>
  return (Object.keys(dictionary.vi) as MessageKey[]).filter((k) => !en[k])
}

export { dictionary }
