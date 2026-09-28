export interface HarnessLimits {
  maxIdenticalToolCalls: number;
  maxMalformedResponses: number;
  maxRunMs: number;
  maxSteps: number;
  maxToolCalls: number;
  modelMaxRetries: number;
  modelTimeoutMs: number;
}

export const DEFAULT_HARNESS_LIMITS: HarnessLimits = {
  maxIdenticalToolCalls: 3,
  maxMalformedResponses: 2,
  maxRunMs: 120_000,
  maxSteps: 10,
  maxToolCalls: 30,
  modelMaxRetries: 2,
  modelTimeoutMs: 60_000,
};
