const DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000] as const;

export interface Metrics {
  observeToolDuration: (tool: string, durationMs: number) => void;
  recordModelRequest: () => void;
  recordSession: (stopReason: string) => void;
  recordToolCall: (tool: string, outcome: string) => void;
  render: () => string;
}

export const createMetrics = (): Metrics => {
  let modelRequests = 0;
  const toolCalls = new Map<string, number>();
  const sessions = new Map<string, number>();
  const duration = new Map<
    string,
    { count: number; sum: number; values: number[] }
  >();

  return {
    observeToolDuration: (tool, durationMs) => {
      const record = duration.get(tool) ?? { count: 0, sum: 0, values: [] };
      record.count += 1;
      record.sum += durationMs;
      record.values.push(durationMs);
      duration.set(tool, record);
    },
    recordModelRequest: () => {
      modelRequests += 1;
    },
    recordSession: (stopReason) => increment(sessions, stopReason),
    recordToolCall: (tool, outcome) =>
      increment(toolCalls, `${tool}\u0000${outcome}`),
    render: () => {
      const lines = [
        "# HELP ops_model_requests_total Total model requests",
        "# TYPE ops_model_requests_total counter",
        `ops_model_requests_total ${modelRequests}`,
        "# HELP ops_tool_calls_total Total tool calls by tool and outcome",
        "# TYPE ops_tool_calls_total counter",
        ...renderLabelCounter(toolCalls, "ops_tool_calls_total", (key) => {
          const [tool = "", outcome = ""] = key.split("\u0000");
          return { outcome, tool };
        }),
        "# HELP ops_sessions_total Total sessions by stop reason",
        "# TYPE ops_sessions_total counter",
        ...renderLabelCounter(sessions, "ops_sessions_total", (stopReason) => ({
          stop_reason: stopReason,
        })),
        "# HELP ops_tool_duration_ms Tool attempt duration in milliseconds",
        "# TYPE ops_tool_duration_ms histogram",
        ...renderHistograms(duration),
      ];
      return `${lines.join("\n")}\n`;
    },
  };
};

const increment = (counter: Map<string, number>, key: string): void => {
  counter.set(key, (counter.get(key) ?? 0) + 1);
};

const renderLabelCounter = (
  counter: Map<string, number>,
  name: string,
  labelsForKey: (key: string) => Record<string, string>
): string[] =>
  [...counter.entries()].map(([key, count]) => {
    const labels = Object.entries(labelsForKey(key))
      .map(([label, value]) => `${label}="${escapeLabel(value)}"`)
      .join(",");
    return `${name}{${labels}} ${count}`;
  });

const renderHistograms = (
  observations: Map<string, { count: number; sum: number; values: number[] }>
): string[] =>
  [...observations.entries()].flatMap(([tool, record]) => [
    ...DURATION_BUCKETS.map((bound) => {
      const count = record.values.filter((value) => value <= bound).length;
      return `ops_tool_duration_ms_bucket{tool="${escapeLabel(tool)}",le="${bound}"} ${count}`;
    }),
    `ops_tool_duration_ms_bucket{tool="${escapeLabel(tool)}",le="+Inf"} ${record.count}`,
    `ops_tool_duration_ms_sum{tool="${escapeLabel(tool)}"} ${record.sum}`,
    `ops_tool_duration_ms_count{tool="${escapeLabel(tool)}"} ${record.count}`,
  ]);

const escapeLabel = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
