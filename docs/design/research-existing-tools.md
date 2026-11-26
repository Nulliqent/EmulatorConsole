# Existing tools

Documentation and release pages read in November 2026. None of the tools was run.

## StackPort
MIT, Python and React on AWS's Cloudscape components, v0.4.13 [1][2]. Names AWS Emulator as supported and finds its keys and certificate automatically. 51 services: 16 dedicated views and 35 generic; EventBridge is generic. Has an API Explorer. Its Activity view reads CloudTrail, where S3 and DynamoDB calls do not appear. It explains unimplemented operations only for its own calls. Open issue #92 is titled "Request/response inspector for debugging emulator calls".

## LocalStack App Inspector and Resource Browser
App Inspector records every call with its request and response payloads [3]. Documented for LocalStack only. Resource Browser shows resources in LocalStack [4].

## MyDevStack
MIT, 25+ services, create and delete, searchable logs [5]. Does not name AWS Emulator.

## Sources
1. pypi.org/project/stackport
2. github.com/DaviReisVieira/stackport
3. docs.localstack.cloud/aws/developer-tools/app-inspector/
4. docs.localstack.cloud/aws/connecting/console/resource-browser/
5. my-devstack.github.io
