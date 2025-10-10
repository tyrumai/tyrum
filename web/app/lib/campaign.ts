export const CAMPAIGN_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export type CampaignParamKey = (typeof CAMPAIGN_PARAM_KEYS)[number];

export type CampaignParams = Partial<Record<CampaignParamKey, string>>;

function normalize(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function extractCampaignParams(
  source: string | URLSearchParams,
): CampaignParams {
  const params =
    typeof source === "string" ? new URLSearchParams(source) : source;
  const result: CampaignParams = {};

  for (const key of CAMPAIGN_PARAM_KEYS) {
    const value = normalize(params.get(key));
    if (value) {
      result[key] = value;
    }
  }

  return result;
}
