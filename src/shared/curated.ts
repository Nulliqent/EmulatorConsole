// The eight Curated Services (GLOSSARY.md: services that also have hand-designed Console pages), by SDK ID as the
// Service Model index spells them. The one place the list is defined.

export const CURATED_SDK_IDS = ["S3", "DynamoDB", "SQS", "SNS", "Lambda", "CloudWatch Logs", "EventBridge", "IAM"] as const;

const CURATED = new Set<string>(CURATED_SDK_IDS);

export function isCurated(sdkId: string): boolean {
  return CURATED.has(sdkId);
}
