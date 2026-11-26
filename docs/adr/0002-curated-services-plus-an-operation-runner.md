---
status: superseded by ADR-0005
---

# Curated Services plus an Operation Runner, not generated pages for every service

The Emulator offers about 439 services, but 311 of their Smithy models declare no resource shapes (including S3, DynamoDB, SQS, SNS and IAM), so pages generated from models would show operations without the resources and relationships Developers look for. Eight services get hand-designed pages (S3, DynamoDB, SQS, SNS, Lambda, CloudWatch Logs, EventBridge, and read-only IAM) and every other service is reached through a model-driven Operation Runner.

## Considered options

- Generated resource pages for all services: broad, but thin or wrong where the model names no resources.
- Curated pages only: leaves hundreds of services unreachable from the Console.
