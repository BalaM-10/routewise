/**
 * Hiding personal details before text goes to the cloud, and putting them back after.
 * The model only finds the details; masking and unmasking are plain string operations,
 * so the round trip is exact and testable.
 */
/** 'detail' is anything else the owner chose to hide, such as a product or a nickname. */
export type EntityType = 'name' | 'email' | 'phone' | 'address' | 'detail';

export interface Entity {
  type: EntityType;
  value: string;
}

export interface Masked {
  text: string;
  /** Placeholder to original text, for example "[NAME 1]" to "Marcus Bell". */
  map: Record<string, string>;
  hidden: Entity[];
  /** Details that were found but could not be located in the text, so nothing was hidden for them. */
  missed: Entity[];
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
/** North American numbers, such as (512) 555-0176 or 214-555-0147. */
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
/** International numbers written with a country code, such as +44 20 7946 0321. */
const PHONE_INTL = /\+\d{1,3}(?:[\s.-]?\(?\d{1,5}\)?){2,6}(?!\d)/g;
/** National numbers that start with 0, such as 07700 900482 or 0491 570 156. */
const PHONE_LOCAL = /\b0\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g;
const digits = (s: string) => s.replace(/\D/g, '').length;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Emails and phone numbers have fixed shapes, so code finds them without a model. */
export function detectWithRules(text: string): Entity[] {
  const found: Entity[] = [];
  for (const m of text.match(EMAIL) ?? []) found.push({ type: 'email', value: m });
  for (const re of [PHONE_INTL, PHONE, PHONE_LOCAL]) {
    for (const m of text.match(re) ?? []) {
      const v = m.trim();
      // Skip a shorter match inside a number already found, and anything too short or long to be a phone number.
      if (digits(v) < 9 || digits(v) > 15 || found.some((f) => f.value.includes(v))) continue;
      found.push({ type: 'phone', value: v });
    }
  }
  return found;
}

/** Best guess of a detail's type from its shape, for details supplied without one. */
export function guessType(value: string): EntityType {
  if (value.includes('@')) return 'email';
  if (/^[\d\s().+-]+$/.test(value) && digits(value) >= 9 && digits(value) <= 15) return 'phone';
  if (/^\d+\s/.test(value)) return 'address';
  return 'name';
}

/** For text the owner hides by hand: a capitalised name stays a name, anything else is a detail. */
export function guessHiddenType(value: string): EntityType {
  const t = guessType(value);
  if (t !== 'name') return t;
  return /^\p{Lu}[\p{L}'.-]*( \p{Lu}[\p{L}'.-]*){0,2}$/u.test(value.trim()) ? 'name' : 'detail';
}

export function mergeEntities(...lists: Entity[][]): Entity[] {
  const seen = new Set<string>();
  const out: Entity[] = [];
  for (const e of lists.flat()) {
    const v = e.value.trim();
    const key = v.toLowerCase();
    if (v.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push({ type: e.type, value: v });
  }
  return out;
}

/**
 * A pattern that finds a detail even when the model wrote it a little differently from the ticket:
 * any spacing, and for phone numbers any punctuation between the digits. Whole words only, so
 * hiding "Ben" leaves "benefit" alone.
 */
function locate(e: Entity): RegExp {
  const v = e.value.trim();
  const body =
    e.type === 'phone' && digits(v) >= 7
      ? '\\+?\\(?' + v.replace(/\D/g, '').split('').join('[\\s().+-]*')
      : escape(v).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Words of a name that can stand alone in a ticket: "Marcus" and "Bell" from "Marcus Bell", not "M." or "de". */
function nameParts(name: string): string[] {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? [] : parts.filter((p) => /^\p{Lu}[\p{L}'-]+$/u.test(p) && p.length >= 2);
}

export function mask(text: string, entities: Entity[]): Masked {
  const counters: Record<EntityType, number> = { name: 0, email: 0, phone: 0, address: 0, detail: 0 };
  const map: Record<string, string> = {};
  const hidden: Entity[] = [];
  const missed: Entity[] = [];
  let out = text;
  const hide = (type: EntityType, re: RegExp) => {
    const first = out.match(re);
    if (!first) return false;
    const token = `[${type.toUpperCase()} ${++counters[type]}]`;
    map[token] = first[0];
    hidden.push({ type, value: first[0] });
    out = out.replace(re, token);
    return true;
  };
  // Longest first, so "Marcus Bell" is replaced before "Marcus".
  const sorted = [...entities].sort((a, b) => b.value.length - a.value.length);
  for (const e of sorted) {
    if (!hide(e.type, locate(e))) missed.push(e);
  }
  // Then any word of a full name that appears on its own, such as "Thanks, Marcus", "thanks marcus" or "Mr. Bell".
  // Whole words only, so "Bell" does not touch "doorbell". Each spelling gets its own placeholder, so the text
  // comes back exactly as written. A lowercase match is only taken for parts of three letters or more.
  for (const e of sorted.filter((x) => x.type === 'name')) {
    for (const part of nameParts(e.value)) {
      const any = new RegExp(`(?<![\\p{L}\\p{N}])${escape(part)}(?![\\p{L}\\p{N}])`, part.length >= 3 ? 'giu' : 'gu');
      for (const spelling of new Set(out.match(any) ?? [])) {
        hide('name', new RegExp(`(?<![\\p{L}\\p{N}])${escape(spelling)}(?![\\p{L}\\p{N}])`, 'gu'));
      }
    }
  }
  // A detail found but not in the text at all is not a leak; only report the ones that are missed in a way that matters.
  return { text: out, map, hidden, missed: missed.filter((e) => !hidden.some((h) => h.value.toLowerCase().includes(e.value.toLowerCase()))) };
}

/**
 * Applies placeholders already chosen for a ticket to other text sent with it, such as order facts,
 * so a detail hidden in the ticket is hidden everywhere in the request.
 */
export function maskWith(text: string, map: Record<string, string>): string {
  let out = text;
  for (const [token, original] of Object.entries(map).sort((a, b) => b[1].length - a[1].length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(original)}(?![\\p{L}\\p{N}])`, 'giu'), token);
  }
  return out;
}

const tokenPattern = (token: string) => {
  const [, type, n] = /^\[(\w+) (\d+)\]$/.exec(token) ?? [];
  return type ? new RegExp(`\\[\\s*${type}\\s*${n}\\s*\\]`, 'gi') : new RegExp(escape(token), 'g');
};

/** A name's first word when it reads as a first name ("Marcus" in "Marcus Bell"), or null ("M. Johnson", "SAM"). */
export function firstName(name: string): string | null {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 && /^\p{Lu}\p{Ll}[\p{L}'-]*$/u.test(parts[0]) ? parts[0] : null;
}

const GREETING = String.raw`\b(Hi|Hello|Hey|Dear|Good (?:morning|afternoon|evening))(,?\s+)`;

/**
 * Restores the details; tolerant of the model changing a placeholder's case or spacing. A full name
 * right after a greeting comes back as the first name, so a reply opens "Hello Marcus," as a person would write it.
 */
export function unmask(text: string, map: Record<string, string>): string {
  let out = text;
  for (const [token, original] of Object.entries(map)) {
    const first = /^\[NAME \d+\]$/i.test(token) ? firstName(original) : null;
    if (first) out = out.replace(new RegExp(GREETING + tokenPattern(token).source, 'gi'), (_m, g: string, sp: string) => `${g}${sp}${first}`);
  }
  for (const [token, original] of Object.entries(map)) out = out.replace(tokenPattern(token), () => original);
  return out;
}

/** Placeholders still in the text after restoring, for example one the model invented. */
export function leftoverTokens(text: string): string[] {
  return text.match(/\[\s*[A-Z]+\s*\d+\s*\]/gi) ?? [];
}

/** Which of the given details still appear in the text. */
export function leaked(text: string, values: string[]): string[] {
  const lower = text.toLowerCase();
  return values.filter((v) => lower.includes(v.toLowerCase()));
}

/** Reads the model's list of details; tolerant of code fences and missing types. */
/** The details the model found, or null when its answer is not the JSON asked for (so nothing can be trusted from it). */
export function tryParseEntities(json: string): Entity[] | null {
  try {
    const obj = JSON.parse(json.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, ''));
    if (!obj || !Array.isArray(obj.items)) return null;
    return parseEntities(json);
  } catch {
    return null;
  }
}

export function parseEntities(json: string): Entity[] {
  try {
    const obj = JSON.parse(json.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/i, '')) as { items?: { type?: string; value?: string }[] };
    return (obj.items ?? [])
      .filter((i) => typeof i.value === 'string' && i.value.trim())
      .map((i) => ({
        type: (['name', 'email', 'phone', 'address'].includes(i.type ?? '') ? i.type : guessType(i.value!)) as EntityType,
        value: i.value!.trim(),
      }));
  } catch {
    return [];
  }
}
