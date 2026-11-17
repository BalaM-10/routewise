import type { AI } from 'firebase/ai';
import type { FirebasePerformance } from 'firebase/performance';

/**
 * The host app owns Firebase initialisation (config, App Check). It hands the engine the
 * AI Logic instance once at startup, so the engine never reads credentials itself.
 */
let aiInstance: AI | null = null;
let perfInstance: FirebasePerformance | null = null;

export function configureRoutewise(opts: { ai: AI; performance?: FirebasePerformance }): void {
  aiInstance = opts.ai;
  perfInstance = opts.performance ?? null;
}

export function getAi(): AI {
  if (!aiInstance) throw new Error('Call configureRoutewise({ ai }) before using Routewise.');
  return aiInstance;
}

export function getPerformanceOrNull(): FirebasePerformance | null {
  return perfInstance;
}
