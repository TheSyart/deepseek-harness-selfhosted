/**
 * Dictionary parity: the en set must cover every zh key so neither locale
 * falls back at render time, and the component's chips reference only keys
 * both dictionaries carry.
 */

import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('locale dictionaries', () => {
  it('carries the same keys in zh and en', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('keeps every key non-empty in both locales', () => {
    for (const key of Object.keys(zh)) {
      expect(zh[key as keyof typeof zh]).not.toBe('')
      expect(en[key as keyof typeof en]).not.toBe('')
    }
  })
})
