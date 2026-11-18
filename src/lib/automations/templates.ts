import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'
import { getT } from '@/lib/i18n/translate'

export type TemplateSlug =
  // Starter — one trigger, a step or two, nothing to configure first.
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  | 'business_hours_info'
  | 'thank_you_close'
  | 'opt_out'
  | 'order_status'
  // Advanced — menus with wait-for-reply, branching, CRM writes, webhooks.
  | 'main_menu'
  | 'lead_capture_deal'
  | 'after_hours_escalation'
  | 'feedback_survey'
  | 're_engagement'
  | 'order_webhook'

/**
 * Which gallery section a template appears in. Starters work as soon as
 * they're activated; advanced ones usually need a tag, pipeline, agent
 * or URL picked in the builder before they can be turned on.
 */
export type TemplateTier = 'starter' | 'advanced'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  tier: TemplateTier
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

const t = getT('StarterAutomations')

/** Comma-separated keyword list from the catalogue → trimmed array. */
function keywords(key: string): string[] {
  return t(key)
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
}

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
    tier: 'starter',
    name: t('welcome_message.name'),
    description: t('welcome_message.description'),
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('welcome_message.text'),
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    tier: 'starter',
    name: t('out_of_office.name'),
    description: t('out_of_office.description'),
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: t('out_of_office.text'),
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    tier: 'starter',
    name: t('lead_qualifier.name'),
    description: t('lead_qualifier.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('lead_qualifier.keywords'),
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: t('lead_qualifier.text'),
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    tier: 'starter',
    name: t('follow_up_reminder.name'),
    description: t('follow_up_reminder.description'),
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: t('follow_up_reminder.text'),
        },
      },
    ],
  },
  business_hours_info: {
    slug: 'business_hours_info',
    tier: 'starter',
    name: t('business_hours_info.name'),
    description: t('business_hours_info.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('business_hours_info.keywords'),
      match_type: 'word',
    },
    steps: [{ step_type: 'send_message', step_config: { text: t('business_hours_info.text') } }],
  },
  thank_you_close: {
    slug: 'thank_you_close',
    tier: 'starter',
    name: t('thank_you_close.name'),
    description: t('thank_you_close.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('thank_you_close.keywords'),
      match_type: 'exact',
    },
    steps: [
      { step_type: 'send_message', step_config: { text: t('thank_you_close.text') } },
      { step_type: 'close_conversation', step_config: {} },
    ],
  },
  opt_out: {
    slug: 'opt_out',
    tier: 'starter',
    name: t('opt_out.name'),
    description: t('opt_out.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('opt_out.keywords'),
      match_type: 'exact',
    },
    steps: [
      { step_type: 'send_message', step_config: { text: t('opt_out.text') } },
      // Pick (or create) a "Do not contact" tag in the builder.
      { step_type: 'add_tag', step_config: { tag_id: '' } },
      { step_type: 'close_conversation', step_config: {} },
    ],
  },
  order_status: {
    slug: 'order_status',
    tier: 'starter',
    name: t('order_status.name'),
    description: t('order_status.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('order_status.keywords'),
      match_type: 'word',
    },
    steps: [
      { step_type: 'send_message', step_config: { text: t('order_status.text') } },
      { step_type: 'assign_conversation', step_config: { mode: 'round_robin' } },
    ],
  },

  main_menu: {
    slug: 'main_menu',
    tier: 'advanced',
    name: t('main_menu.name'),
    description: t('main_menu.description'),
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        // Buttons on the Cloud API; numbered options over GOWA. Either
        // way the reply's title becomes {{ message.text }} for the
        // conditions below.
        step_type: 'send_buttons',
        step_config: {
          kind: 'buttons',
          body: t('main_menu.body'),
          buttons: [
            { id: 'menu_sales', title: t('main_menu.sales') },
            { id: 'menu_support', title: t('main_menu.support') },
            { id: 'menu_hours', title: t('main_menu.hours') },
          ],
          wait_for_reply: true,
        },
      },
      {
        step_type: 'condition',
        step_config: { subject: 'message_content', value: t('main_menu.sales') },
      },
      {
        step_type: 'send_message',
        step_config: { text: t('main_menu.salesReply') },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'condition',
        step_config: { subject: 'message_content', value: t('main_menu.support') },
        parent_index: 1,
        branch: 'no',
      },
      {
        step_type: 'send_message',
        step_config: { text: t('main_menu.supportReply') },
        parent_index: 4,
        branch: 'yes',
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
        parent_index: 4,
        branch: 'yes',
      },
      {
        step_type: 'send_message',
        step_config: { text: t('main_menu.hoursReply') },
        parent_index: 4,
        branch: 'no',
      },
    ],
  },
  lead_capture_deal: {
    slug: 'lead_capture_deal',
    tier: 'advanced',
    name: t('lead_capture_deal.name'),
    description: t('lead_capture_deal.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('lead_capture_deal.keywords'),
      match_type: 'word',
    },
    steps: [
      {
        step_type: 'send_buttons',
        step_config: {
          kind: 'buttons',
          body: t('lead_capture_deal.body'),
          buttons: [
            { id: 'budget_small', title: t('lead_capture_deal.small') },
            { id: 'budget_medium', title: t('lead_capture_deal.medium') },
            { id: 'budget_large', title: t('lead_capture_deal.large') },
          ],
          wait_for_reply: true,
        },
      },
      // Pick the pipeline + first stage in the builder.
      {
        step_type: 'create_deal',
        step_config: {
          pipeline_id: '',
          stage_id: '',
          // The budget the customer picked, via the wait-for-reply above.
          title: `${t('lead_capture_deal.dealTitle')} ({{ message.text }})`,
        },
      },
      { step_type: 'add_tag', step_config: { tag_id: '' } },
      { step_type: 'assign_conversation', step_config: { mode: 'round_robin' } },
      { step_type: 'send_message', step_config: { text: t('lead_capture_deal.confirm') } },
    ],
  },
  after_hours_escalation: {
    slug: 'after_hours_escalation',
    tier: 'advanced',
    name: t('after_hours_escalation.name'),
    description: t('after_hours_escalation.description'),
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: { subject: 'time_of_day', operand: '18:00-09:00' },
      },
      {
        step_type: 'send_message',
        step_config: { text: t('after_hours_escalation.text') },
        parent_index: 0,
        branch: 'yes',
      },
      // Pick an "After hours" tag so the morning shift can filter on it.
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
        parent_index: 0,
        branch: 'yes',
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
        parent_index: 0,
        branch: 'no',
      },
    ],
  },
  feedback_survey: {
    slug: 'feedback_survey',
    tier: 'advanced',
    name: t('feedback_survey.name'),
    description: t('feedback_survey.description'),
    // Fires when an agent adds the chosen tag (e.g. "Resolved").
    trigger_type: 'tag_added',
    trigger_config: { tag_id: '' },
    steps: [
      {
        step_type: 'send_buttons',
        step_config: {
          kind: 'buttons',
          body: t('feedback_survey.body'),
          buttons: [
            { id: 'rating_great', title: t('feedback_survey.great') },
            { id: 'rating_ok', title: t('feedback_survey.ok') },
            { id: 'rating_poor', title: t('feedback_survey.poor') },
          ],
          wait_for_reply: true,
        },
      },
      {
        step_type: 'condition',
        step_config: { subject: 'message_content', value: t('feedback_survey.poor') },
      },
      {
        step_type: 'send_message',
        step_config: { text: t('feedback_survey.poorReply') },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
        parent_index: 1,
        branch: 'yes',
      },
      {
        step_type: 'send_message',
        step_config: { text: t('feedback_survey.thanksReply') },
        parent_index: 1,
        branch: 'no',
      },
    ],
  },
  re_engagement: {
    slug: 're_engagement',
    tier: 'advanced',
    name: t('re_engagement.name'),
    description: t('re_engagement.description'),
    // Fires when the chosen tag (e.g. "Interested") is added.
    trigger_type: 'tag_added',
    trigger_config: { tag_id: '' },
    steps: [
      { step_type: 'wait', step_config: { amount: 2, unit: 'days' } },
      { step_type: 'send_message', step_config: { text: t('re_engagement.first') } },
      { step_type: 'wait', step_config: { amount: 3, unit: 'days' } },
      { step_type: 'send_message', step_config: { text: t('re_engagement.second') } },
    ],
  },
  order_webhook: {
    slug: 'order_webhook',
    tier: 'advanced',
    name: t('order_webhook.name'),
    description: t('order_webhook.description'),
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: keywords('order_webhook.keywords'),
      match_type: 'word',
    },
    steps: [
      // Point this at your order system / Zapier / n8n webhook.
      {
        step_type: 'send_webhook',
        step_config: {
          url: '',
          headers: { 'Content-Type': 'application/json' },
          body_template: '{"source":"whatsapp","message":"{{ message.text }}"}',
        },
      },
      { step_type: 'send_message', step_config: { text: t('order_webhook.text') } },
    ],
  },
}

/** Gallery order within each tier. */
export const TEMPLATE_ORDER: Record<TemplateTier, TemplateSlug[]> = {
  starter: [
    'welcome_message',
    'out_of_office',
    'business_hours_info',
    'lead_qualifier',
    'follow_up_reminder',
    'thank_you_close',
    'opt_out',
    'order_status',
  ],
  advanced: [
    'main_menu',
    'lead_capture_deal',
    'after_hours_escalation',
    'feedback_survey',
    're_engagement',
    'order_webhook',
  ],
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}
