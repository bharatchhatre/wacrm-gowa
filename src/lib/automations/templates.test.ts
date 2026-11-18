import { describe, expect, it } from 'vitest'
import { AUTOMATION_TEMPLATES, TEMPLATE_ORDER, getTemplate } from './templates'
import { validateStepsForActivation, validateTriggerForActivation } from './validate'

const all = Object.values(AUTOMATION_TEMPLATES)

/** Problems the builder makes the user fix before activating. */
function issues(slug: string) {
  const tpl = getTemplate(slug)!
  return [
    ...validateTriggerForActivation(tpl.trigger_type, tpl.trigger_config as Record<string, unknown>),
    ...validateStepsForActivation(
      tpl.steps as unknown as { step_type: string; step_config: Record<string, unknown> }[],
    ),
  ]
}

describe('automation templates', () => {
  it('lists every template exactly once, in its own tier', () => {
    const listed = [...TEMPLATE_ORDER.starter, ...TEMPLATE_ORDER.advanced]
    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual(Object.keys(AUTOMATION_TEMPLATES).sort())
    for (const tier of ['starter', 'advanced'] as const) {
      for (const slug of TEMPLATE_ORDER[tier]) expect(AUTOMATION_TEMPLATES[slug].tier).toBe(tier)
    }
  })

  it('has a translated name, description and non-empty step texts', () => {
    for (const tpl of all) {
      expect(tpl.name).not.toMatch(/^StarterAutomations\.|\.name$/)
      expect(tpl.description.length).toBeGreaterThan(10)
      expect(tpl.steps.length).toBeGreaterThan(0)
      for (const step of tpl.steps) {
        const cfg = step.step_config as { text?: string; body?: string }
        if (step.step_type === 'send_message') expect(cfg.text?.length).toBeGreaterThan(0)
        if (step.step_type === 'send_buttons') expect(cfg.body?.length).toBeGreaterThan(0)
      }
    }
  })

  it('points every branch at a condition earlier in the list', () => {
    for (const tpl of all) {
      tpl.steps.forEach((step, i) => {
        if (step.parent_index == null) return
        expect(step.parent_index).toBeLessThan(i)
        expect(tpl.steps[step.parent_index].step_type).toBe('condition')
        expect(['yes', 'no']).toContain(step.branch)
      })
    }
  })

  it('lets most starters activate as-is; the rest only need a tag picked', () => {
    // Tagging is the point of these two, and tags are per-account.
    const needTag = new Set(['welcome_message', 'opt_out'])
    for (const slug of TEMPLATE_ORDER.starter) {
      expect(issues(slug).length, slug).toBe(needTag.has(slug) ? 1 : 0)
    }
    // The flagship menu needs nothing configured.
    expect(issues('main_menu')).toEqual([])
  })

  it('keeps the keyword lists non-empty', () => {
    for (const tpl of all) {
      if (tpl.trigger_type !== 'keyword_match') continue
      const kws = (tpl.trigger_config as { keywords: string[] }).keywords
      expect(kws.length).toBeGreaterThan(0)
      expect(kws.every((k) => k.length > 0)).toBe(true)
    }
  })
})
