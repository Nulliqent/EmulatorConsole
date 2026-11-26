# Emulator Console

A local web console for developers who run AWS Emulator on their own machine and need to see what their code did to it.

## Language

**Console**:
The product in this repository: the interface a Developer uses to inspect and debug an Emulator.
_Avoid_: dashboard, UI, AWS Console

**AWS Console**:
The AWS Management Console that Amazon operates for real AWS accounts. It is never what "Console" means here.
_Avoid_: the console, real console

**Emulator**:
A running instance of AWS Emulator. Its resources exist only for that run.
_Avoid_: backend, server, AWS, mock

**Developer**:
A person running an Emulator on their own machine who knows the AWS services their code uses.
_Avoid_: user, customer, admin, learner

### Calls

**Gateway**:
The optional endpoint a Developer points their SDK at so that each Call reaches the Emulator and is recorded.
_Avoid_: proxy, middleware, interceptor

**Call**:
One AWS API request sent through the Gateway, together with its response. A request sent straight to the Emulator is not a Call.
_Avoid_: request, event, log entry, trace

**Emulator Gap**:
An operation or behaviour that AWS provides and the Emulator does not, so a failure caused by one is not the Developer's mistake.
_Avoid_: bug, unsupported feature, limitation

### Services

**Service Model**:
AWS's published description of one service's operations and their inputs, outputs and errors.
_Avoid_: schema, spec, API definition

**Generated Page**:
A Console page derived from a Service Model, available for every service the Emulator offers.
_Avoid_: default page, fallback page, generic view

**Curated Service**:
An AWS service that also has Console pages designed by hand.
_Avoid_: supported service, first-class service

**Operation Runner**:
The generated form that sends any single operation of any AWS service the Emulator offers and shows its response.
_Avoid_: API explorer, playground

**Destructive Operation**:
An operation that removes or irreversibly changes what it names, such as a delete or a terminate.
_Avoid_: dangerous action, write

### Runs

**Emulator Run**:
The period between an Emulator's start and its stop. Every resource in it is lost when it ends.
_Avoid_: session, instance, uptime

**Marker**:
A point the Developer sets within an Emulator Run, against which the Console shows which top-level resources of Curated Services in the Active Region were later added or removed. It does not compare objects, items or messages.
_Avoid_: snapshot, checkpoint, baseline

### Diagnosis

**Verdict**:
The Console's evidence-limited reading of why a Call failed: Emulator Gap, Request Rejected or Unclear. A Call that succeeded has none, even if the Emulator behaved wrongly.
_Avoid_: diagnosis, root cause, status

**Request Rejected**:
The Verdict for a Call that failed with a client error the service's model declares.
_Avoid_: user error, bad request

**Unclear**:
The Verdict for a failed Call whose evidence supports neither other Verdict.
_Avoid_: unknown error, internal error

### Scope

**Active Region**:
The one AWS Region whose resources the Console is showing. Calls are listed from every Region regardless of it.
_Avoid_: current region, selected region
