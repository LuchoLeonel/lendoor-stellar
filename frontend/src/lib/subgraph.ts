// lib/subgraph.ts
export const SUBGRAPH_ID =
  "61kWhSMxViLT7WKisyzwD5XYHpgfXYv3mzkQWQmrRruT"

const GRAPH_API_KEY = import.meta.env.VITE_GRAPH_API_KEY as string | undefined

export const SUBGRAPH_URL = GRAPH_API_KEY
  ? `https://gateway.thegraph.com/api/${GRAPH_API_KEY}/subgraphs/id/${SUBGRAPH_ID}`
  : `https://api.studio.thegraph.com/query/1718667/lendoor-sub/version/latest`

export const SECONDS_PER_DAY = 86400

export function unixNow() {
  return Math.floor(Date.now() / 1000)
}