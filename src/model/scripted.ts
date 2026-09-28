import type {
  ModelClient,
  ModelError,
  ModelRequest,
  ModelResponse,
} from "@/model/model.js";

export type ScriptedStep =
  | ModelResponse
  | ((request: ModelRequest) => unknown | Promise<unknown>)
  | { throw: ModelError };

export class ScriptedModel implements ModelClient {
  readonly #steps: ScriptedStep[];
  readonly requests: ModelRequest[] = [];

  constructor(steps: ScriptedStep[]) {
    this.#steps = [...steps];
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const step = this.#steps.shift();
    if (step === undefined) {
      throw new Error("ScriptedModel exhausted");
    }
    if ("throw" in step) {
      throw step.throw;
    }
    if (typeof step === "function") {
      return (await step(request)) as ModelResponse;
    }
    return step;
  }
}
