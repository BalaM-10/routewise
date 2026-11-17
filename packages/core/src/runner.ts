import { getGenerativeModel, InferenceMode } from 'firebase/ai';
import type { GenerativeModel, ModelParams } from 'firebase/ai';
import { getAi } from './context';
import { TEXT_ONLY } from './device';
import type { Mode, Sample, Task } from './types';

const cache = new Map<string, GenerativeModel>();

function structured(task?: Task): { mime?: string; schema?: object } {
  if (!task) return {};
  if (task.validator.kind === 'json') return { mime: 'application/json', schema: task.validator.schema };
  if (task.validator.kind === 'enum')
    return { mime: 'text/x.enum', schema: { type: 'string', enum: task.validator.values } };
  return {};
}

/**
 * One model instance per (mode, cloud model, task). The same schema is sent to the cloud
 * (responseSchema) and to Chrome (responseConstraint), so both sides are tested on equal terms.
 */
export function modelFor(mode: Mode, cloudModel: string, task?: Task, schemaOverride?: object): GenerativeModel {
  const s = schemaOverride ? { mime: 'application/json', schema: schemaOverride } : structured(task);
  const key = `${mode}|${cloudModel}|${task?.id ?? '-'}|${schemaOverride ? JSON.stringify(schemaOverride) : ''}`;
  let m = cache.get(key);
  if (!m) {
    const inCloudParams: ModelParams = {
      model: cloudModel,
      generationConfig: {
        temperature: 0,
        ...(s.mime ? { responseMimeType: s.mime, responseSchema: s.schema as any } : {}),
      },
    };
    m = getGenerativeModel(getAi(), {
      mode: InferenceMode[mode],
      inCloudParams,
      onDeviceParams: {
        createOptions: TEXT_ONLY,
        ...(s.schema ? { promptOptions: { responseConstraint: s.schema } } : {}),
      },
    });
    cache.set(key, m);
  }
  return m;
}

/** Must be called from a user gesture before any on-device request. */
export async function prepareOnDevice(cloudModel: string, onProgress: (fraction: number) => void): Promise<void> {
  await modelFor('ONLY_ON_DEVICE', cloudModel).initializeDeviceModel(onProgress);
}

export function buildPrompt(task: Task, input: string): string {
  return `${task.instruction}\n\n---\n${input}\n---`;
}

export interface Timed extends Sample {
  source?: 'on_device' | 'in_cloud';
}

/**
 * timeoutMs limits how long to wait for an answer, on the device or in the cloud. Without it,
 * one overloaded cloud request (the SDK waits three minutes) or one stalled on-device answer
 * can hold up a whole calibration run.
 */
export async function timedGenerate(model: GenerativeModel, prompt: string, timeoutMs?: number): Promise<Timed> {
  const t0 = performance.now();
  try {
    const call = timeoutMs ? model.generateContent(prompt, { timeout: timeoutMs }) : model.generateContent(prompt);
    // The SDK timeout covers cloud requests only; an on-device answer can stall, so race it too.
    const result = timeoutMs
      ? await Promise.race([
          call,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`No answer within ${Math.round(timeoutMs / 1000)} s (timeout)`)), timeoutMs),
          ),
        ])
      : await call;
    const text = result.response.text();
    return {
      ok: true,
      valid: true,
      ms: Math.round(performance.now() - t0),
      text,
      source: result.response.inferenceSource,
    };
  } catch (e) {
    return {
      ok: false,
      valid: false,
      ms: Math.round(performance.now() - t0),
      text: '',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
