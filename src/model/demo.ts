import type { ChatMessages } from "@openrouter/sdk/models";
import type {
  ModelClient,
  ModelRequest,
  ModelResponse,
} from "@/model/model.js";
import { serviceStatuses } from "@/tools/ops/service-status.js";

type PlainRecord = Record<string, unknown>;

interface ToolResult {
  arguments: PlainRecord;
  result: PlainRecord;
}

export class DemoModel implements ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse> {
    const objective = request.messages
      .filter((message) => message.role === "user")
      .map((message) => contentText(message.content))
      .join(" ");
    const service = Object.keys(serviceStatuses).find((name) =>
      new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(objective)
    );
    if (!service) {
      return Promise.resolve(
        answer(`I could not identify a supported service in: ${objective}`)
      );
    }

    const statusTool = findToolResult(request.messages, "get_service_status");
    if (!statusTool) {
      return Promise.resolve(
        callTool("get_service_status", { service_name: service })
      );
    }

    const { status } = statusTool.result;
    const knowledgeTool = findToolResult(
      request.messages,
      "search_knowledge_base"
    );
    if (!knowledgeTool) {
      return Promise.resolve(
        callTool("search_knowledge_base", {
          query: `${service} runbook`,
        })
      );
    }

    const knowledgeResults = Array.isArray(knowledgeTool.result.results)
      ? knowledgeTool.result.results
          .map((entry) => {
            if (!isRecord(entry)) {
              return "";
            }
            return `${stringValue(entry.title)}: ${stringValue(entry.snippet)}`;
          })
          .filter(Boolean)
          .join(" ")
      : "No matching runbook found.";
    if (status !== "operational") {
      const incidentTool = findToolResult(request.messages, "create_incident");
      if (!incidentTool) {
        return Promise.resolve(
          callTool("create_incident", {
            description: `${service} is ${stringValue(status)}. Investigate the service and follow the runbook.`,
            severity: status === "outage" ? "high" : "medium",
            title: `${service} service ${stringValue(status)}`,
          })
        );
      }
      if (incidentTool.result.error === true) {
        return Promise.resolve(
          answer(
            `${service} is ${stringValue(status)}. Runbook: ${knowledgeResults} Incident creation was denied: ${stringValue(incidentTool.result.message)}`
          )
        );
      }
      return Promise.resolve(
        answer(
          `${service} is ${stringValue(status)}. Runbook: ${knowledgeResults} Incident ${stringValue(incidentTool.result.incidentId)} was created.`
        )
      );
    }
    return Promise.resolve(
      answer(`${service} is operational. Runbook: ${knowledgeResults}`)
    );
  }
}

const callTool = (name: string, input: PlainRecord): ModelResponse => ({
  stopReason: "tool_use",
  text: "",
  toolCalls: [{ id: `demo_${name}`, input, name }],
});

const answer = (text: string): ModelResponse => ({
  stopReason: "end_turn",
  text,
  toolCalls: [],
});

const findToolResult = (
  messages: ChatMessages[],
  name: string
): ToolResult | undefined => {
  for (const message of messages) {
    if (message.role !== "assistant" || !message.toolCalls) {
      continue;
    }
    for (const call of message.toolCalls) {
      if (call.function.name !== name) {
        continue;
      }
      const response = messages.find(
        (candidate) =>
          candidate.role === "tool" && candidate.toolCallId === call.id
      );
      if (!response) {
        continue;
      }
      let args: unknown;
      let result: unknown;
      try {
        args = JSON.parse(call.function.arguments);
        result = JSON.parse(contentText(response.content));
      } catch {
        continue;
      }
      if (isRecord(args) && isRecord(result)) {
        return { arguments: args, result };
      }
    }
  }
  return undefined;
};

const contentText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        isRecord(part) && part.type === "text" ? stringValue(part.text) : ""
      )
      .join("");
  }
  return "";
};

const isRecord = (value: unknown): value is PlainRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string =>
  typeof value === "string" ? value : "unknown";

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
