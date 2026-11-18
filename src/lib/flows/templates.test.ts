import { describe, expect, it } from 'vitest'
import { listFlowTemplates } from './templates'
import { validateFlowForActivation } from './validate'

const templates = listFlowTemplates()

function errors(slug: string) {
  const tpl = templates.find((t) => t.slug === slug)!
  return validateFlowForActivation(
    {
      name: tpl.name,
      trigger_type: tpl.trigger_type,
      trigger_config: tpl.trigger_config as Record<string, unknown>,
      entry_node_id: tpl.entry_node_id,
    },
    tpl.nodes as unknown as { node_key: string; node_type: string; config: Record<string, unknown> }[],
  ).filter((i) => i.severity === 'error')
}

describe('flow templates', () => {
  it('ships 13 templates with unique slugs', () => {
    expect(templates).toHaveLength(13)
    expect(new Set(templates.map((t) => t.slug)).size).toBe(13)
  })

  // offers_opt_in tags subscribers, and tags are per-account, so its
  // set_tag node needs a tag picked in the builder first.
  it.each(templates.map((t) => t.slug).filter((s) => s !== 'offers_opt_in'))(
    '%s validates for activation as shipped',
    (slug) => {
      expect(errors(slug)).toEqual([])
    },
  )

  it('offers_opt_in only asks for the tag', () => {
    const issues = errors('offers_opt_in')
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((i) => i.node_key === 'tag')).toBe(true)
  })

  it('injects {{vars.*}} placeholders rather than raw ICU args', () => {
    for (const tpl of templates) {
      const text = JSON.stringify(tpl.nodes)
      expect(text, tpl.slug).not.toMatch(/\{(date|time|order|name|guests|email|item|quantity|issue|feedback|need|category)\}/)
    }
  })

  it('keeps reply ids unique within each template', () => {
    for (const tpl of templates) {
      const ids = tpl.nodes.flatMap((n) => {
        const c = n.config as {
          buttons?: { reply_id: string }[]
          sections?: { rows: { reply_id: string }[] }[]
        }
        return [...(c.buttons ?? []), ...(c.sections ?? []).flatMap((s) => s.rows)].map((b) => b.reply_id)
      })
      expect(new Set(ids).size, tpl.slug).toBe(ids.length)
    }
  })
})
