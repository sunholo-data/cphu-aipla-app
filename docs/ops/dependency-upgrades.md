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

## Pre-production review — browser Origin and upstream status

The original `v0.1.102` smoke checks omitted browser Origin headers. A real
browser write to the public frontend was therefore rejected by ADK's sidecar
Origin middleware even though CLI chat and history checks passed.

The fix originated in
[Aitana-Labs/platform](https://github.com/Aitana-Labs/platform/commit/1dd05369047a40aace13d6f3f02dcef7a603c9ae).
Its shared-source port,
[platform-source#76](https://github.com/sunholo-data/platform-source/pull/76),
was still open on 2026-10-23. It was not present in the AIPLA proxy.
The shared proxy now drops the browser Origin on the server-to-sidecar hop
and preserves Authorization. Real-HTTP regression tests cover all four write
methods. Branch deployments, production promotions and the standalone smoke
script now require a browser-shaped anonymous write to reach auth (401),
rather than fail the sidecar's Origin check (403).

Upstream's current default branch is `dev`, at `9f6a2088` when reviewed. It
still pins ADK 1.39.1 and has a separate ADK 2 migration project; this fork's
OpenTelemetry fix is not a merged upstream upgrade. The routing script now
reads `UPSTREAM_BRANCH` from `.template-fork-target`, which was still pointing
to the retired `main` branch. The last full reconciliation pin is unchanged.

Additional pre-production evidence on 2026-10-23:

- The production-built frontend, connected locally to the upgraded test
  backend, passed browser-Origin authentication and a real tutor turn through
  the installed `@ag-ui/client` 0.0.52. The client parsed the terminal event
  and the resulting assistant message; session history was readable afterward.
  This verifies the exercised chat path without assuming that backend and
  frontend package version numbers must match.
- An isolated environment using production's `v0.1.99` lockfile and ADK 1.31.1
  successfully read four events, including user and model content, from that
  ADK 2 test session via the real Vertex session service. This proves history
  read compatibility; it does not constitute a full application rollback drill.
