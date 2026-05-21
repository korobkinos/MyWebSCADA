import { api, type TrendQueryRequest, type TrendQueryResponse, type TrendRangeResponse, type TrendTagInfo } from "../../services/api";

export async function fetchTrendTags(signal?: AbortSignal): Promise<TrendTagInfo[]> {
  return api.getTrendTags({ signal });
}

export async function fetchTrendRange(tags: string[]): Promise<TrendRangeResponse> {
  return api.getTrendsRange(tags);
}

export async function queryTrendData(
  request: TrendQueryRequest,
  options?: { signal?: AbortSignal; replaceInFlight?: boolean; skipConnectivityGate?: boolean; inFlightKey?: string | null },
): Promise<TrendQueryResponse> {
  return api.queryTrends(request, options);
}
