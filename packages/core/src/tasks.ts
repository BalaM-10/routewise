import type { Input, Task } from './types';
import { words } from './stats';
import { guessType, mask } from './mask';

import ticketData from './data/tickets.json';
import orderData from './data/orders.json';

/** Fictional support tickets with known answers. Every name, email, phone number and address is invented. */
export interface Ticket {
  text: string;
  category: string;
  orderId: string | null;
  product: string | null;
  pii: string[];
}

/** A fictional order, as a shop's order system would return it. Contains no personal details. */
export interface Order {
  id: string;
  product: string;
  status: string;
  placed: string;
  total: number;
  shipped?: string;
  carrier?: string;
  tracking?: string;
  delivered?: string;
  returnReceived?: string;
  refund?: string;
  note?: string;
}

export const tickets: Ticket[] = ticketData as Ticket[];
export const orders: Order[] = orderData as Order[];

const key = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The order number in a ticket, found by plain pattern matching (for example #B2210 or H-2291). */
export function orderIdIn(text: string): string | null {
  return /#?\b([A-Z]-?\d{4})\b/i.exec(text)?.[1]?.toUpperCase() ?? null;
}

/** Plain lookup, no model involved: the order a ticket refers to, if the shop has it. */
export function findOrder(id: string | null | undefined): Order | null {
  if (!id) return null;
  return orders.find((o) => key(o.id) === key(id)) ?? null;
}

const followUps = [
  'Agent: Thanks for reaching out. I have opened a case and asked the warehouse team to look into it. Could you confirm the best time to contact you?',
  'Customer: Any time after 5pm works. I would also like to know whether this affects my other open order, which I placed the following week.',
  'Agent: I checked the second order and it is on schedule. For the first one, the carrier says the parcel was scanned at the regional hub but missed the onward truck.',
  'Customer: That is frustrating, this is the second time this has happened with this carrier. Is there a way to choose a different courier in future?',
  'Agent: I understand. I have added a note to your account to prefer the alternative courier, and I have applied a discount code to your next purchase as an apology.',
  'Customer: Thank you. If the parcel does not arrive by Friday I would rather have a refund than a replacement, because I needed it for an event this weekend.',
  'Agent: Noted. I have set a reminder for Friday morning. If tracking has not moved by then I will process the refund without you needing to contact us again.',
  'Customer: One more thing, the confirmation email showed the wrong apartment number. Can you make sure the courier has the correct one?',
];

const fmt = (d?: string) =>
  d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

/** The facts the shop's order system holds, as short lines. Orders contain no personal details. */
export function orderFacts(o: Order): string[] {
  const lines = [`Order ${o.id}: ${o.product}, $${o.total.toFixed(2)}, placed ${fmt(o.placed)}.`, `Status: ${o.status}.`];
  if (o.shipped) lines.push(`Shipped ${fmt(o.shipped)}${o.carrier ? ` by ${o.carrier}` : ''}${o.tracking ? `, tracking ${o.tracking}` : ''}.`);
  else if (o.carrier) lines.push(`Carrier: ${o.carrier}${o.tracking ? `, tracking ${o.tracking}` : ''}.`);
  if (o.delivered) lines.push(`Delivered ${fmt(o.delivered)}.`);
  if (o.returnReceived) lines.push(`Return received ${fmt(o.returnReceived)}.`);
  if (o.note) lines.push(`Note: ${o.note}`);
  if (o.refund) lines.push(`Refund: ${o.refund}.`);
  return lines;
}

export interface Voice {
  shop: string;
  signOff: string;
  tone: 'warm' | 'formal' | 'brief';
}

/** What the cloud receives for a reply: the masked ticket, the order facts and the shop's voice. */
export function composeReplyInput(maskedTicket: string, facts: string[] = [], voice?: Voice): string {
  const parts = [maskedTicket];
  parts.push(facts.length
    ? `ORDER FACTS (from the shop's order system):\n${facts.map((f) => `- ${f}`).join('\n')}`
    : "ORDER FACTS: none found in the shop's order system.");
  if (voice) {
    const tone = voice.tone === 'formal' ? 'formal and courteous' : voice.tone === 'brief' ? 'brief and to the point' : 'warm and friendly';
    parts.push(`SHOP VOICE: write for ${voice.shop}, in a ${tone} tone, and sign off as "${voice.signOff}".`);
  }
  return parts.join('\n\n');
}

/** A support thread of roughly `target` words, starting from a real ticket. */
export function buildThread(ticket: Ticket, target: number): string {
  const parts = [`Customer: ${ticket.text}`];
  let i = 0;
  while (words(parts.join('\n')) < target) parts.push(followUps[i++ % followUps.length]);
  return parts.join('\n');
}

const LENGTH_TIERS = [150, 800, 2000, 4000, 6000];

/** The ticket as Shopdesk sends it to the cloud: personal details already replaced by placeholders. */
export const masked = (t: Ticket): Input => ({ text: mask(t.text, t.pii.map((v) => ({ type: guessType(v), value: v }))).text });

/** A reply input exactly as Shopdesk builds it: masked ticket plus the order facts, if the shop has the order. */
export const replyInput = (t: Ticket): Input => {
  const o = findOrder(t.orderId);
  return { text: composeReplyInput(masked(t).text, o ? orderFacts(o) : []) };
};

export const defaultTasks: Task[] = [
  {
    id: 'triage',
    name: 'Triage the ticket',
    instruction:
      "Classify this support ticket by the customer's main request, as exactly one of: shipping (delivery, tracking or where an order is), refund (the customer asks for money back, a return, or a wrong or double charge to be fixed), product (questions or problems with a product, without asking for money back), account (login, password, profile, saved details, email preferences or account security), other (anything else, such as wholesale, press, gift cards, compliments or empty messages).",
    inputs: tickets.map((t) => ({ text: t.text, gold: { label: t.category } })),
    validator: { kind: 'enum', values: ['shipping', 'refund', 'product', 'account', 'other'] },
    scoring: 'gold-label',
    sensitive: true,
    latencyBudgetMs: 2000,
  },
  {
    id: 'extract',
    name: 'Extract order details',
    instruction:
      'Extract the order id (without #), the product and a short issue description from this support ticket. Use an empty string when a value is not present.',
    inputs: tickets.map((t) => ({
      text: t.text,
      gold: { fields: { order_id: t.orderId, product: t.product } },
    })),
    validator: {
      kind: 'json',
      schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string' },
          product: { type: 'string' },
          issue: { type: 'string' },
        },
        required: ['order_id', 'product', 'issue'],
      },
    },
    scoring: 'gold-fields',
    sensitive: true,
    latencyBudgetMs: 4000,
  },
  {
    id: 'summary',
    name: 'Summarize the thread',
    instruction: 'Summarize this support conversation in at most two sentences for the next agent. Reply with the summary only.',
    inputs: LENGTH_TIERS.flatMap((tier) =>
      [tickets[0], tickets[4], tickets[1]].map((t) => ({ text: buildThread(t, tier), tier })),
    ),
    validator: { kind: 'text', maxWords: 70 },
    scoring: 'judge',
    sensitive: false,
    latencyBudgetMs: 8000,
    lengthSweep: true,
  },
  {
    id: 'reply',
    name: 'Draft a reply',
    instruction:
      'Write a short, friendly reply from the support agent to this ticket (at most 120 words). Personal details are replaced by placeholders such as [NAME 1]; keep any placeholder you use exactly as written and never make up a new one. If order facts are given, rely only on them for status, dates and refunds, and promise nothing beyond them: keep their conditions and wording (if they say eligible for a refund by a date, say exactly that, not a full or guaranteed refund). If no order facts are given, do not say that anything has been done, sent, refunded or scheduled, and give no dates: say the team will look into it and get back to them. Reply with the message only.',
    inputs: tickets.slice(0, 24).map(replyInput),
    validator: { kind: 'text', maxWords: 150 },
    scoring: 'judge',
    sensitive: false,
    latencyBudgetMs: 10000,
  },
  {
    id: 'pii',
    name: 'Find personal details',
    instruction:
      'List every personal detail in this support ticket: names of people, email addresses, phone numbers and street addresses. Copy each value exactly as written.',
    inputs: tickets.map((t) => ({ text: t.text, gold: { mustNotContain: t.pii } })),
    validator: {
      kind: 'json',
      schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['name', 'email', 'phone', 'address'] },
                value: { type: 'string' },
              },
              required: ['type', 'value'],
            },
          },
        },
        required: ['items'],
      },
    },
    scoring: 'gold-masking',
    sensitive: true,
    latencyBudgetMs: 6000,
  },
];
