/**
 * Ready-made message templates for Settings → Templates → Library.
 *
 * Each entry is a complete `/api/whatsapp/templates/submit` payload,
 * including the sample values Meta requires for every `{{n}}` variable.
 * On a Meta connection, adding one submits it for review. On a GOWA
 * connection it's saved as APPROVED straight away, since there's no
 * review.
 *
 * Written to pass Meta's review as-is: no variable at the very start
 * or end of the body, a sample for every variable, footers under 60
 * characters and buttons under 25. Edit the wording to taste before
 * submitting — the template name is what you'll pick in broadcasts
 * and automations.
 */

import type { TemplatePayload } from './template-validators';

export interface LibraryTemplate extends TemplatePayload {
  /** Short label for the library card. The template `name` is the id. */
  title: string;
}

export const TEMPLATE_LIBRARY: LibraryTemplate[] = [
  {
    title: 'Welcome',
    name: 'welcome_new_customer',
    category: 'Marketing',
    language: 'en_US',
    body_text:
      'Hi {{1}}, welcome to {{2}}! 🎉 We are glad you are here. Reply to this message any time if you have a question.',
    footer_text: 'Reply STOP to opt out',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Browse products' },
      { type: 'QUICK_REPLY', text: 'Talk to us' },
    ],
    sample_values: { body: ['Ana', 'Acme Store'] },
  },
  {
    title: 'Order confirmation',
    name: 'order_confirmation',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'Hi {{1}}, thanks for your order {{2}}! We have received it and will let you know as soon as it ships. Order total: {{3}}.',
    sample_values: { body: ['Ana', '#10234', '$49.90'] },
  },
  {
    title: 'Shipping update',
    name: 'shipping_update',
    category: 'Utility',
    language: 'en_US',
    header_type: 'text',
    header_content: 'Your order is on its way 🚚',
    body_text:
      'Good news, {{1}}! Your order {{2}} has shipped and should arrive by {{3}}. Use the button below to track it.',
    buttons: [{ type: 'URL', text: 'Track order', url: 'https://example.com/track' }],
    sample_values: { body: ['Ana', '#10234', 'Friday, 21 Nov'] },
  },
  {
    title: 'Appointment reminder',
    name: 'appointment_reminder',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'Hi {{1}}, this is a reminder of your appointment on {{2}} at {{3}}. Please let us know if you can make it.',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Confirm' },
      { type: 'QUICK_REPLY', text: 'Reschedule' },
    ],
    sample_values: { body: ['Ana', 'Monday, 24 Nov', '3:00 PM'] },
  },
  {
    title: 'Payment reminder',
    name: 'payment_reminder',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'Hi {{1}}, a friendly reminder that invoice {{2}} for {{3}} is due on {{4}}. Please ignore this message if you have already paid.',
    sample_values: { body: ['Ana', 'INV-2041', '$120.00', '30 Nov'] },
  },
  {
    title: 'Abandoned cart',
    name: 'abandoned_cart_reminder',
    category: 'Marketing',
    language: 'en_US',
    body_text:
      'Hi {{1}}, you left something in your cart 🛒 Complete your order today and get {{2}} off with code {{3}} at checkout.',
    footer_text: 'Reply STOP to opt out',
    buttons: [{ type: 'URL', text: 'Complete order', url: 'https://example.com/cart' }],
    sample_values: { body: ['Ana', '10%', 'COMEBACK10'] },
  },
  {
    title: 'Promotion',
    name: 'seasonal_promotion',
    category: 'Marketing',
    language: 'en_US',
    header_type: 'text',
    header_content: 'Our sale is on! 🎉',
    body_text:
      'Hi {{1}}, our {{2}} sale has started. Enjoy up to {{3}} off selected items until {{4}}. Do not miss out!',
    footer_text: 'Reply STOP to opt out',
    buttons: [
      // Meta wants quick replies grouped before URL buttons.
      { type: 'QUICK_REPLY', text: 'Stop promotions' },
      { type: 'URL', text: 'Shop now', url: 'https://example.com/sale' },
    ],
    sample_values: { body: ['Ana', 'Black Friday', '50%', '30 Nov'] },
  },
  {
    title: 'Feedback request',
    name: 'feedback_request',
    category: 'Marketing',
    language: 'en_US',
    body_text:
      'Hi {{1}}, thanks for choosing {{2}}! How was your experience with us? Your feedback helps us improve.',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Great' },
      { type: 'QUICK_REPLY', text: 'Okay' },
      { type: 'QUICK_REPLY', text: 'Not good' },
    ],
    sample_values: { body: ['Ana', 'Acme Store'] },
  },
  {
    title: 'We miss you',
    name: 'we_miss_you',
    category: 'Marketing',
    language: 'en_US',
    body_text:
      'Hi {{1}}, we miss you! It has been a while, so here is {{2}} off your next order with code {{3}}. We would love to see you again.',
    footer_text: 'Reply STOP to opt out',
    sample_values: { body: ['Ana', '15%', 'WELCOMEBACK'] },
  },
  {
    title: 'Support ticket update',
    name: 'support_ticket_update',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'Hi {{1}}, your support request {{2}} has been updated: {{3}}. Reply to this message if you need anything else.',
    sample_values: { body: ['Ana', '#5521', 'a technician is on the way'] },
  },
];

/** The submit-route payload for a library entry (drops the UI label). */
export function libraryPayload(entry: LibraryTemplate): TemplatePayload {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { title, ...payload } = entry;
  return payload;
}
