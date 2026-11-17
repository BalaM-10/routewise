import type { Gold, JsonSchema, Validator } from './types';
import { words } from './stats';
import { detectWithRules, leaked, mask, mergeEntities, parseEntities } from './mask';

/** An answer that opens by refusing. Quoted user text such as "I can't log in" is not a refusal. */
const REFUSAL = /^\W*(i'm sorry|i am sorry|sorry, (?:but )?i|as an ai|i (?:can(?:'|no)t|cannot|am unable to|'m unable to) (?:help|assist|comply|do that|provide|complete))/i;

export function stripFences(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

export function normalizeLabel(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z]/g, '');
}

function matches(value: unknown, s: JsonSchema): boolean {
  if (value === null) return !!s.nullable;
  switch (s.type) {
    case 'string':
      return typeof value === 'string' && (!s.enum || s.enum.includes(value));
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value) && (!s.items || value.every((v) => matches(v, s.items!)));
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return false;
      const obj = value as Record<string, unknown>;
      if ((s.required ?? []).some((k) => !(k in obj))) return false;
      return Object.entries(s.properties ?? {}).every(([k, sub]) => !(k in obj) || matches(obj[k], sub));
    }
  }
}

export function validate(text: string, v: Validator): boolean {
  const t = text.trim();
  if (!t) return false;
  switch (v.kind) {
    case 'text':
      return words(t) <= v.maxWords && !REFUSAL.test(t);
    case 'enum':
      return v.values.includes(normalizeLabel(t));
    case 'json':
      try {
        return matches(JSON.parse(stripFences(t)), v.schema);
      } catch {
        return false;
      }
  }
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Deterministic 1-5 score against a gold answer. `input` is needed for masking tasks. */
export function goldScore(text: string, gold: Gold, scoring: string, input = ''): number {
  if (scoring === 'gold-masking') {
    // Would any personal detail survive if the app masked the ticket with what was found?
    const entities = mergeEntities(parseEntities(text), detectWithRules(input));
    const out = mask(input, entities).text;
    // A full name counts as leaked if any word of it is still there on its own ("Thanks, Marcus", "Grant & Co.").
    const parts = (gold.mustNotContain ?? []).flatMap((v) => (/^[\p{Lu}][\p{L}'-]+(\s+[\p{Lu}][\p{L}'-]+)+$/u.test(v) ? v.split(/\s+/) : []));
    const partLeft = parts.some((p) => new RegExp(`(?<![\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, p.length >= 3 ? 'iu' : 'u').test(out));
    return leaked(out, gold.mustNotContain ?? []).length === 0 && !partLeft ? 5 : 1;
  }
  if (scoring === 'gold-label') {
    return normalizeLabel(text) === normalizeLabel(gold.label ?? '') ? 5 : 1;
  }
  if (scoring === 'gold-redaction') {
    const lower = text.toLowerCase();
    const leaked = (gold.mustNotContain ?? []).filter((p) => lower.includes(p.toLowerCase()));
    return leaked.length === 0 ? 5 : 1;
  }
  // gold-fields: every expected field must match (substring either way, ignoring case and punctuation)
  try {
    const obj = JSON.parse(stripFences(text)) as Record<string, string | null>;
    const fields = Object.entries(gold.fields ?? {});
    const hits = fields.filter(([k, want]) => {
      const got = obj[k];
      if (want === null) return got === null || got === undefined || norm(got) === '';
      const a = norm(got);
      const b = norm(want);
      // An order number must match exactly ("B2210", not "2210"); a product may be named more or less fully.
      if (k === 'order_id') return a === b;
      return !!a && (a.includes(b) || b.includes(a));
    }).length;
    if (hits === fields.length) return 5;
    return hits === 0 ? 1 : 3;
  } catch {
    return 1;
  }
}
