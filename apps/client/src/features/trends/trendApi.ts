import { api, type TrendQueryRequest, type TrendQueryResponse, type TrendRangeResponse, type TrendTagInfo } from "../../services/api";

export async function fetchTrendTags(): Promise<TrendTagInfo[]> {
  return api.getTrendTags();
}

export async function fetchTrendRange(tags: string[]): Promise<TrendRangeResponse> {
  return api.getTrendsRange(tags);
}

export async function queryTrendData(request: TrendQueryRequest, signal?: AbortSignal): Promise<TrendQueryResponse> {
  return api.queryTrends(request, { signal });
}
