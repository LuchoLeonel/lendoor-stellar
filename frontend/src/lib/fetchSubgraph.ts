// lib/fetchSubgraph.ts
import { SUBGRAPH_URL } from "./subgraph"

const GRAPH_API_KEY = import.meta.env.VITE_GRAPH_API_KEY ?? ""

export async function fetchSubgraph<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(GRAPH_API_KEY ? { Authorization: `Bearer ${GRAPH_API_KEY}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!res.ok) {
    throw new Error(`Subgraph error: ${res.status}`)
  }

  const json = await res.json()

  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("\n"))
  }

  return json.data
}