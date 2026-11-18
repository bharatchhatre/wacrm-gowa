import { describe, expect, it } from 'vitest'
import { TEMPLATE_LIBRARY, libraryPayload } from './template-library'
import { validateTemplatePayload } from './template-validators'

describe('template library', () => {
  it('ships 10 templates with unique names', () => {
    expect(TEMPLATE_LIBRARY).toHaveLength(10)
    expect(new Set(TEMPLATE_LIBRARY.map((t) => t.name)).size).toBe(10)
  })

  it.each(TEMPLATE_LIBRARY.map((t) => [t.name, t] as const))(
    '%s passes the submit validator',
    (_name, entry) => {
      expect(() => validateTemplatePayload(libraryPayload(entry))).not.toThrow()
    },
  )

  it('never starts or ends a body with a variable (Meta rejects those)', () => {
    for (const t of TEMPLATE_LIBRARY) {
      expect(t.body_text.trim(), t.name).not.toMatch(/^\{\{\d+\}\}/)
      expect(t.body_text.trim(), t.name).not.toMatch(/\{\{\d+\}\}$/)
    }
  })

  it('keeps the UI label out of the payload', () => {
    expect(libraryPayload(TEMPLATE_LIBRARY[0])).not.toHaveProperty('title')
  })
})
