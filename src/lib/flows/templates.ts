/**
 * Starter flow templates.
 *
 * Pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 */

import type {
  CollectInputNodeConfig,
  ConditionNodeConfig,
  SetTagNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  StartNodeConfig,
} from "./types";
import { getT } from "@/lib/i18n/translate";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

/** lucide-react icon names the flows gallery knows how to render. */
export type FlowTemplateIcon =
  | "MessageSquare"
  | "HelpCircle"
  | "UserPlus"
  | "CalendarCheck"
  | "Package"
  | "ShoppingBag"
  | "LifeBuoy"
  | "Star"
  | "PhoneCall"
  | "PartyPopper"
  | "FileText"
  | "BellRing"
  | "UserCheck";

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon: FlowTemplateIcon;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

const t = getT("StarterFlows");

/** Comma-separated keyword list from the catalogue → trimmed array. */
function keywords(key: string): string[] {
  return t(key)
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  name: t("welcome_menu.name"),
  description: t("welcome_menu.description"),
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: { keywords: keywords("welcome_menu.keywords"), match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: t("welcome_menu.text"),
        footer_text: t("welcome_menu.footer"),
        buttons: [
          {
            reply_id: "existing",
            title: t("welcome_menu.existingButton"),
            next_node_key: "existing_handoff",
          },
          {
            reply_id: "new",
            title: t("welcome_menu.newButton"),
            next_node_key: "new_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "existing_handoff",
      node_type: "handoff",
      config: {
        note: t("welcome_menu.existingNote"),
      } as HandoffNodeConfig,
    },
    {
      node_key: "new_handoff",
      node_type: "handoff",
      config: {
        note: t("welcome_menu.newNote"),
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  name: t("faq_bot.name"),
  description: t("faq_bot.description"),
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: keywords("faq_bot.keywords"),
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "topics" },
    },
    {
      node_key: "topics",
      node_type: "send_list",
      config: {
        text: t("faq_bot.text"),
        button_label: t("faq_bot.buttonLabel"),
        sections: [
          {
            title: t("faq_bot.commonSection"),
            rows: [
              {
                reply_id: "hours",
                title: t("faq_bot.hoursRow"),
                next_node_key: "answer_hours",
              },
              {
                reply_id: "pricing",
                title: t("faq_bot.pricingRow"),
                next_node_key: "answer_pricing",
              },
              {
                reply_id: "refunds",
                title: t("faq_bot.refundsRow"),
                next_node_key: "answer_refunds",
              },
            ],
          },
          {
            title: t("faq_bot.otherSection"),
            rows: [
              {
                reply_id: "human",
                title: t("faq_bot.humanRow"),
                next_node_key: "human_handoff",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "answer_hours",
      node_type: "send_message",
      config: {
        text: t("faq_bot.hoursAnswer"),
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_pricing",
      node_type: "send_message",
      config: {
        text: t("faq_bot.pricingAnswer"),
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_refunds",
      node_type: "send_message",
      config: {
        text: t("faq_bot.refundsAnswer"),
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "human_handoff",
      node_type: "handoff",
      config: {
        note: t("faq_bot.humanNote"),
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  name: t("lead_capture.name"),
  description: t("lead_capture.description"),
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "intro" },
    },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: t("lead_capture.intro"),
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: t("lead_capture.askName"),
        var_key: "name",
        next_node_key: "ask_email",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: t("lead_capture.askEmail", { name: "{{vars.name}}" }),
        var_key: "email",
        next_node_key: "ask_company",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_company",
      node_type: "collect_input",
      config: {
        prompt_text: t("lead_capture.askCompany"),
        var_key: "company",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: t("lead_capture.handoffNote", {
          name: "{{vars.name}}",
          email: "{{vars.email}}",
          company: "{{vars.company}}",
        }),
      } as HandoffNodeConfig,
    },
  ],
};


// ============================================================
// Shorthand for the templates below. Each returns one node; keys
// are stable strings so edges can reference them directly.
// ============================================================
const start = (next: string): FlowTemplateNode => ({
  node_key: "start",
  node_type: "start",
  config: { next_node_key: next },
});
const msg = (key: string, text: string, next: string): FlowTemplateNode => ({
  node_key: key,
  node_type: "send_message",
  config: { text, next_node_key: next } as SendMessageNodeConfig,
});
const ask = (
  key: string,
  prompt: string,
  varKey: string,
  next: string,
  validation?: CollectInputNodeConfig["validation"],
): FlowTemplateNode => ({
  node_key: key,
  node_type: "collect_input",
  config: {
    prompt_text: prompt,
    var_key: varKey,
    next_node_key: next,
    ...(validation ? { validation } : {}),
  } as CollectInputNodeConfig,
});
const handoff = (key: string, note: string): FlowTemplateNode => ({
  node_key: key,
  node_type: "handoff",
  config: { note } as HandoffNodeConfig,
});
const END: FlowTemplateNode = { node_key: "end", node_type: "end", config: {} };
const kw = (slug: string) => ({
  keywords: keywords(`${slug}.keywords`),
  match_type: "contains" as const,
});
/** `{{vars.x}}` placeholder, passed through the catalogue's ICU args. */
const v = (key: string) => `{{vars.${key}}}`;

// ============================================================
// 4. Appointment booking — pick a service, a day and a time
// ============================================================
const APPOINTMENT_BOOKING: FlowTemplate = {
  slug: "appointment_booking",
  name: t("appointment_booking.name"),
  description: t("appointment_booking.description"),
  icon: "CalendarCheck",
  trigger_type: "keyword",
  trigger_config: kw("appointment_booking"),
  entry_node_id: "start",
  nodes: [
    start("service"),
    {
      node_key: "service",
      node_type: "send_list",
      config: {
        text: t("appointment_booking.text"),
        button_label: t("appointment_booking.buttonLabel"),
        sections: [
          {
            title: t("appointment_booking.section"),
            rows: [
              { reply_id: "consultation", title: t("appointment_booking.consultation"), next_node_key: "ask_date" },
              { reply_id: "service_visit", title: t("appointment_booking.visit"), next_node_key: "ask_date" },
              { reply_id: "follow_up", title: t("appointment_booking.followUp"), next_node_key: "ask_date" },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    ask("ask_date", t("appointment_booking.askDate"), "date", "ask_time"),
    ask("ask_time", t("appointment_booking.askTime"), "time", "confirm"),
    msg("confirm", t("appointment_booking.confirm", { date: v("date"), time: v("time") }), "handoff"),
    handoff("handoff", t("appointment_booking.note", { date: v("date"), time: v("time") })),
  ],
};

// ============================================================
// 5. Order tracking — capture the order number, hand to an agent
// ============================================================
const ORDER_TRACKING: FlowTemplate = {
  slug: "order_tracking",
  name: t("order_tracking.name"),
  description: t("order_tracking.description"),
  icon: "Package",
  trigger_type: "keyword",
  trigger_config: kw("order_tracking"),
  entry_node_id: "start",
  nodes: [
    start("ask_order"),
    ask("ask_order", t("order_tracking.askOrder"), "order_number", "checking"),
    msg("checking", t("order_tracking.checking", { order: v("order_number") }), "handoff"),
    handoff("handoff", t("order_tracking.note", { order: v("order_number") })),
  ],
};

// ============================================================
// 6. Product catalogue — browse categories, or talk to sales
// ============================================================
const PRODUCT_CATALOG: FlowTemplate = {
  slug: "product_catalog",
  name: t("product_catalog.name"),
  description: t("product_catalog.description"),
  icon: "ShoppingBag",
  trigger_type: "keyword",
  trigger_config: kw("product_catalog"),
  entry_node_id: "start",
  nodes: [
    start("categories"),
    {
      node_key: "categories",
      node_type: "send_list",
      config: {
        text: t("product_catalog.text"),
        button_label: t("product_catalog.buttonLabel"),
        sections: [
          {
            title: t("product_catalog.section"),
            rows: [
              { reply_id: "cat_new", title: t("product_catalog.newArrivals"), next_node_key: "info_new" },
              { reply_id: "cat_best", title: t("product_catalog.bestSellers"), next_node_key: "info_best" },
              { reply_id: "cat_offers", title: t("product_catalog.offers"), next_node_key: "info_offers" },
            ],
          },
          {
            title: t("product_catalog.otherSection"),
            rows: [{ reply_id: "cat_sales", title: t("product_catalog.talkToSales"), next_node_key: "sales" }],
          },
        ],
      } as SendListNodeConfig,
    },
    msg("info_new", t("product_catalog.newAnswer"), "end"),
    msg("info_best", t("product_catalog.bestAnswer"), "end"),
    msg("info_offers", t("product_catalog.offersAnswer"), "end"),
    handoff("sales", t("product_catalog.salesNote")),
    END,
  ],
};

// ============================================================
// 7. Support triage — category + description, then an agent
// ============================================================
const SUPPORT_TRIAGE: FlowTemplate = {
  slug: "support_triage",
  name: t("support_triage.name"),
  description: t("support_triage.description"),
  icon: "LifeBuoy",
  trigger_type: "keyword",
  trigger_config: kw("support_triage"),
  entry_node_id: "start",
  nodes: [
    start("category"),
    {
      node_key: "category",
      node_type: "send_buttons",
      config: {
        text: t("support_triage.text"),
        buttons: [
          { reply_id: "billing", title: t("support_triage.billing"), next_node_key: "ask_billing" },
          { reply_id: "technical", title: t("support_triage.technical"), next_node_key: "ask_technical" },
          { reply_id: "other", title: t("support_triage.other"), next_node_key: "ask_other" },
        ],
      } as SendButtonsNodeConfig,
    },
    ask("ask_billing", t("support_triage.askDetails"), "issue", "handoff_billing"),
    ask("ask_technical", t("support_triage.askDetails"), "issue", "handoff_technical"),
    ask("ask_other", t("support_triage.askDetails"), "issue", "handoff_other"),
    handoff("handoff_billing", t("support_triage.note", { category: t("support_triage.billing"), issue: v("issue") })),
    handoff("handoff_technical", t("support_triage.note", { category: t("support_triage.technical"), issue: v("issue") })),
    handoff("handoff_other", t("support_triage.note", { category: t("support_triage.other"), issue: v("issue") })),
  ],
};

// ============================================================
// 8. Feedback / review — happy customers get the review link,
//    unhappy ones are asked why and handed to a person
// ============================================================
const FEEDBACK_REVIEW: FlowTemplate = {
  slug: "feedback_review",
  name: t("feedback_review.name"),
  description: t("feedback_review.description"),
  icon: "Star",
  trigger_type: "keyword",
  trigger_config: kw("feedback_review"),
  entry_node_id: "start",
  nodes: [
    start("rate"),
    {
      node_key: "rate",
      node_type: "send_buttons",
      config: {
        text: t("feedback_review.text"),
        buttons: [
          { reply_id: "great", title: t("feedback_review.great"), next_node_key: "review_link" },
          { reply_id: "okay", title: t("feedback_review.okay"), next_node_key: "ask_improve" },
          { reply_id: "poor", title: t("feedback_review.poor"), next_node_key: "ask_improve" },
        ],
      } as SendButtonsNodeConfig,
    },
    msg("review_link", t("feedback_review.reviewLink"), "end"),
    ask("ask_improve", t("feedback_review.askImprove"), "feedback", "sorry"),
    msg("sorry", t("feedback_review.sorry"), "handoff"),
    handoff("handoff", t("feedback_review.note", { feedback: v("feedback") })),
    END,
  ],
};

// ============================================================
// 9. Callback request — name + best time, then queue for a call
// ============================================================
const CALLBACK_REQUEST: FlowTemplate = {
  slug: "callback_request",
  name: t("callback_request.name"),
  description: t("callback_request.description"),
  icon: "PhoneCall",
  trigger_type: "keyword",
  trigger_config: kw("callback_request"),
  entry_node_id: "start",
  nodes: [
    start("ask_name"),
    ask("ask_name", t("callback_request.askName"), "name", "ask_time"),
    ask("ask_time", t("callback_request.askTime", { name: v("name") }), "best_time", "confirm"),
    msg("confirm", t("callback_request.confirm", { time: v("best_time") }), "handoff"),
    handoff("handoff", t("callback_request.note", { name: v("name"), time: v("best_time") })),
  ],
};

// ============================================================
// 10. Event RSVP — yes / maybe / no, head-count for a yes
// ============================================================
const EVENT_RSVP: FlowTemplate = {
  slug: "event_rsvp",
  name: t("event_rsvp.name"),
  description: t("event_rsvp.description"),
  icon: "PartyPopper",
  trigger_type: "keyword",
  trigger_config: kw("event_rsvp"),
  entry_node_id: "start",
  nodes: [
    start("rsvp"),
    {
      node_key: "rsvp",
      node_type: "send_buttons",
      config: {
        text: t("event_rsvp.text"),
        buttons: [
          { reply_id: "rsvp_yes", title: t("event_rsvp.yes"), next_node_key: "ask_guests" },
          { reply_id: "rsvp_maybe", title: t("event_rsvp.maybe"), next_node_key: "maybe" },
          { reply_id: "rsvp_no", title: t("event_rsvp.no"), next_node_key: "no" },
        ],
      } as SendButtonsNodeConfig,
    },
    ask("ask_guests", t("event_rsvp.askGuests"), "guests", "confirmed"),
    msg("confirmed", t("event_rsvp.confirmed", { guests: v("guests") }), "end"),
    msg("maybe", t("event_rsvp.maybeReply"), "end"),
    msg("no", t("event_rsvp.noReply"), "end"),
    END,
  ],
};

// ============================================================
// 11. Quote request — what, how many, where to send it
// ============================================================
const QUOTE_REQUEST: FlowTemplate = {
  slug: "quote_request",
  name: t("quote_request.name"),
  description: t("quote_request.description"),
  icon: "FileText",
  trigger_type: "keyword",
  trigger_config: kw("quote_request"),
  entry_node_id: "start",
  nodes: [
    start("ask_item"),
    ask("ask_item", t("quote_request.askItem"), "item", "ask_quantity"),
    ask("ask_quantity", t("quote_request.askQuantity"), "quantity", "ask_email"),
    ask("ask_email", t("quote_request.askEmail"), "email", "thanks", "email"),
    msg("thanks", t("quote_request.thanks", { email: v("email") }), "handoff"),
    handoff(
      "handoff",
      t("quote_request.note", { item: v("item"), quantity: v("quantity"), email: v("email") }),
    ),
  ],
};

// ============================================================
// 12. Offers opt-in — tag subscribers for broadcasts
// ============================================================
const OFFERS_OPT_IN: FlowTemplate = {
  slug: "offers_opt_in",
  name: t("offers_opt_in.name"),
  description: t("offers_opt_in.description"),
  icon: "BellRing",
  trigger_type: "keyword",
  trigger_config: kw("offers_opt_in"),
  entry_node_id: "start",
  nodes: [
    start("ask"),
    {
      node_key: "ask",
      node_type: "send_buttons",
      config: {
        text: t("offers_opt_in.text"),
        buttons: [
          { reply_id: "optin_yes", title: t("offers_opt_in.yes"), next_node_key: "tag" },
          { reply_id: "optin_no", title: t("offers_opt_in.no"), next_node_key: "declined" },
        ],
      } as SendButtonsNodeConfig,
    },
    // Pick your "Offers subscriber" tag in the builder before activating.
    {
      node_key: "tag",
      node_type: "set_tag",
      config: { mode: "add", tag_id: "", next_node_key: "subscribed" } as SetTagNodeConfig,
    },
    msg("subscribed", t("offers_opt_in.subscribed"), "end"),
    msg("declined", t("offers_opt_in.declined"), "end"),
    END,
  ],
};

// ============================================================
// 13. Returning-customer check — branch on whether we already
//     have the contact's email
// ============================================================
const RETURNING_CUSTOMER: FlowTemplate = {
  slug: "returning_customer",
  name: t("returning_customer.name"),
  description: t("returning_customer.description"),
  icon: "UserCheck",
  trigger_type: "keyword",
  trigger_config: kw("returning_customer"),
  entry_node_id: "start",
  nodes: [
    start("known"),
    {
      node_key: "known",
      node_type: "condition",
      config: {
        subject: "contact_field",
        subject_key: "email",
        operator: "present",
        true_next: "welcome_back",
        false_next: "ask_email",
      } as ConditionNodeConfig,
    },
    msg("welcome_back", t("returning_customer.welcomeBack"), "handoff_known"),
    ask("ask_email", t("returning_customer.askEmail"), "email", "ask_need", "email"),
    ask("ask_need", t("returning_customer.askNeed"), "need", "handoff_new"),
    handoff("handoff_known", t("returning_customer.knownNote")),
    handoff("handoff_new", t("returning_customer.newNote", { email: v("email"), need: v("need") })),
  ],
};

// ============================================================
// Registry
// ============================================================

const TEMPLATES: Record<string, FlowTemplate> = {
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
  appointment_booking: APPOINTMENT_BOOKING,
  order_tracking: ORDER_TRACKING,
  product_catalog: PRODUCT_CATALOG,
  support_triage: SUPPORT_TRIAGE,
  feedback_review: FEEDBACK_REVIEW,
  callback_request: CALLBACK_REQUEST,
  event_rsvp: EVENT_RSVP,
  quote_request: QUOTE_REQUEST,
  offers_opt_in: OFFERS_OPT_IN,
  returning_customer: RETURNING_CUSTOMER,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
