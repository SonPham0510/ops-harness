import { z } from "zod";
import { defineTool } from "@/core/tools/registry.js";

export interface KnowledgeBaseEntry {
  id: string;
  snippet: string;
  title: string;
}

export const knowledgeBaseEntries: KnowledgeBaseEntry[] = [
  {
    id: "kb-checkout",
    snippet:
      "If checkout latency exceeds 300ms, check the checkout service pods and recent deploys.",
    title: "Checkout latency runbook",
  },
  {
    id: "kb-payments",
    snippet:
      "Payment failures are usually caused by the payment provider outage.",
    title: "Payments incident runbook",
  },
  {
    id: "kb-search",
    snippet: "Search index lag causes stale results and high error rates.",
    title: "Search index lag runbook",
  },
  {
    id: "kb-cart",
    snippet: "Cart recovery restores abandoned carts after a checkout outage.",
    title: "Cart recovery guide",
  },
  {
    id: "kb-orders",
    snippet: "Order sync retries failed order events every 30 seconds.",
    title: "Order sync retry guide",
  },
  {
    id: "kb-auth",
    snippet:
      "Auth token expiry causes 401s; rotate secrets before deploying auth.",
    title: "Auth token rotation runbook",
  },
  {
    id: "kb-db",
    snippet: "Primary database failover should complete within 60 seconds.",
    title: "Database failover runbook",
  },
];

const inputSchema = z.object({
  query: z.string().min(1).max(500),
});

const outputSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        score: z.number(),
        snippet: z.string(),
        title: z.string(),
      })
    )
    .max(5),
});

const TOKEN_REGEX = /[^a-z0-9]+/;

const tokenize = (text: string): string[] =>
  text.toLowerCase().split(TOKEN_REGEX).filter(Boolean);

const score = (query: string, entry: KnowledgeBaseEntry): number => {
  const queryTokens = tokenize(query);
  const haystack = tokenize(`${entry.title} ${entry.snippet}`);
  return queryTokens.reduce(
    (total, token) => total + (haystack.includes(token) ? 1 : 0),
    0
  );
};

export const createKnowledgeBaseTool = (options?: {
  entries?: KnowledgeBaseEntry[];
}) => {
  const entries = options?.entries ?? knowledgeBaseEntries;
  return defineTool({
    description:
      "Search internal documentation for runbooks, guides, and known issues.",
    handler: ({ query }) => {
      const ranked = entries
        .map((entry) => ({
          ...entry,
          score: score(query, entry),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ id, score: entryScore, snippet, title }) => ({
          id,
          score: entryScore,
          snippet,
          title,
        }));
      return Promise.resolve({ results: ranked });
    },
    input: inputSchema,
    name: "search_knowledge_base",
    output: outputSchema,
  });
};
