# Dependency upgrade notes

## OpenTelemetry security fix — 2026-10-23

`opentelemetry-api` 1.38.0 was affected by
[CVE-2026-114603](https://github.com/open-telemetry/opentelemetry-python/security/advisories/GHSA-xcq7-p3pf-p88h):
quadratic parsing of an inbound `tracestate` header could block a worker.
The first patched release is 1.45.1.

ADK 1.x cannot simply take that patch: its telemetry setup imports the Events
API removed by OpenTelemetry 1.44. The compatible stack uses:

- `google-adk[gcp,db,a2a]` 2.12.0, with the same version range for evals.
  The extras retain integrations that ADK 2 made optional.
- `ag-ui-adk` 0.10.0 and its required `a2ui-agent-sdk` 0.2.2. A2UI 0.2.3
  and 0.2.4 reference an unimported `models` name during module import;
  0.9 changes the SDK interface used by this application.
- OpenTelemetry API and SDK 1.45.1 together. uv resolves the matching
  instrumentation, semantic conventions and OTLP exporter packages.

ADK 2.12 still declares an OpenTelemetry ceiling of 1.42.1. The two explicit
`tool.uv.override-dependencies` entries bypass the declared API/SDK bounds;
other telemetry packages retain their normal constraints. Remove these overrides when ADK's
published constraints permit 1.45.1 or newer. Revalidate the telemetry imports,
stream lifecycle, backend suite and live agent evals when changing this stack.

The newer chat bridge keeps a ContextVar token across stream yields. Heartbeat
and progress polling now iterate and close each upstream generator in one
producer task, with a bounded queue for backpressure. Creating a task for every
`anext` caused token-reset errors when a student stream finished.

Regression coverage checks real oversized-header rejection, normal trace
propagation, cloud telemetry imports, and stream cleanup on completion,
disconnect and failure. The dependency audit retains its existing policy;
no exception was added for this vulnerability.

ADK 2 sends cloud telemetry through `telemetry.googleapis.com`. The API was
already enabled in dev and test on 2026-10-23; it is now also declared in the
environment API list and bootstrap script. The existing Cloud Trace Agent role
includes `telemetry.traces.write`. No IAM grants were changed.
