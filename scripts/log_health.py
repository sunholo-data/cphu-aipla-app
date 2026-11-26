#!/usr/bin/env python3
"""log_health.py — is a deployed AIPLA environment healthy? One read-only report.

Usage:
  scripts/log_health.py <dev|test|prod> [--hours 24]
  make log-health ENV=prod [HOURS=24]

Reads Cloud Logging (``gcloud logging read``, nothing else) and sorts every
warning and error into:

  PROBLEMS   5xx responses and errors nobody has explained — start here
  LOOK AT    warnings and 4xx that are not on the known list
  RECOVERED  failures the app handled itself (model stall → retry/fallback)
  KNOWN      real gaps that are understood and tracked, with the reason
  NOISE      one line per kind: bot probes, expected 404s, startup notices

plus the browser-side errors (``aipla_client_error``) and the sim browser
checks (``aipla-v01-sim-verify``).

Why it exists: on prod ~95% of WARNING lines are bots probing for ``/.env`` and
friends, so a raw ``severity>=WARNING`` read buries the few lines that matter.
The 2026-11-24 triage did this sort by hand; the rules below are what it found.
When a new kind of line turns out to be harmless, add a rule here WITH the
reason, so the next reader does not re-investigate it.

Python's own WARNING/ERROR lines reach Cloud Logging with no severity (they are
plain stdout), so a severity filter alone misses them; they are read separately.

Exit codes: 0 no problems · 1 problems found · 2 a read failed. A read that
failed is never reported as healthy — see the "checker answers when it could
not read its subject" footgun in CLAUDE.md.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone

PROJECTS = {"dev": "aipla-dev-2026", "test": "aipla-test-2026", "prod": "aipla-prod-2026"}

PROBLEM, LOOK, RECOVERED, KNOWN, NOISE, SKIP = "problem", "look", "recovered", "known", "noise", "skip"

# A path a bot probes for: secrets, VCS metadata, other stacks' admin pages, archives.
_PROBE = re.compile(
    r"(^|/)\.(env|git|aws|svn|hg|htaccess|htpasswd|ds_store|circleci|vscode|idea|ssh|docker|npmrc|well-known/security)"
    r"|\.(php|asp|aspx|jsp|cgi|sql|bak|old|zip|tar|gz|tgz|rar|7z|ya?ml|ini|log|conf|xml)$"
    r"|(^|/)(wp-|wordpress|phpmyadmin|actuator|server-status|vendor/composer|telescope|_profiler|cgi-bin|owa|"
    r"autodiscover|boaform|HNAP1|solr|druid|jenkins|manager/html|console|debug|admin\.|config\.json|settings\.json|"
    r"service_account\.json|credentials|secrets|backup|dump|env$|api/v\d/namespaces)",
    re.IGNORECASE,
)

# Paths the app itself requests; a 404 on one of these is worth a look unless a rule below explains it.
_APP_PATH = re.compile(r"^/(api/proxy/|_next/|vendor/(three|anatomy-kit)/|artefacts/|chat/|teacher/|lessons|group)")

# (kind, label, matcher on the request path) for 4xx responses whose cause is known.
_HTTP_RULES: list[tuple[str, str, re.Pattern[str], set[int]]] = [
    (
        NOISE,
        "co-pilot opened on a thread not started yet (404 until the teacher's first message; client treats it as a fresh chat)",
        re.compile(r"^/api/proxy/api/sessions/[^/]+/messages$"),
        {404},
    ),
    (
        NOISE,
        "public screenshot asked for a class-level sim (none by design; the page shows a plain tile)",
        re.compile(r"^/api/proxy/api/public/sims/[^/]+/screenshot/"),
        {404},
    ),
    (
        NOISE,
        "script from the previous build, asked for by a tab open across a deploy (the page reloads itself)",
        re.compile(r"^/_next/static/"),
        {404},
    ),
    (
        NOISE,
        "group report's final-work panel asked for a tutor id as an activity (group was on a tutor, not an "
        "activity; the panel shows nothing)",
        re.compile(r"^/api/proxy/api/activities/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
        {404},
    ),
    (NOISE, "favicon", re.compile(r"^/favicon\.ico$"), {404}),
    (NOISE, "MCP endpoint probed without the MCP Accept header", re.compile(r"^/api/mcp$"), {406}),
    (NOISE, "method probe on / (POST/OPTIONS/PROPFIND)", re.compile(r"^/$"), {405}),
    (
        NOISE,
        "signed-in page polled after its token expired (the page re-auths)",
        re.compile(r"^/api/proxy/api/"),
        {401},
    ),
    (NOISE, "sim checker health probe without a token (it is IAM-only)", re.compile(r"^/(ready)?$"), {403}),
]

# (kind, label, matcher on the message text) for non-HTTP lines.
_TEXT_RULES: list[tuple[str, str, re.Pattern[str]]] = [
    (
        NOISE,
        "unknown /project page (crawler); Next.js logs its correct 404 as ERROR because dynamicParams=false",
        re.compile(r"NoFallbackError"),
    ),
    (
        NOISE,
        "server action posted by a bot or a tab open across a deploy",
        re.compile(r"Server Reference ID did not match|Failed to find Server Action"),
    ),
    # 2026-11-26 — Google's per-minute quota (Agent Engine: 100 session-event
    # appends/min for the project). A retry that worked is RECOVERED; one that
    # did not was shown to a student as "AIPLA is busy, wait a moment", so it is
    # a PROBLEM even though the app handled it: the quota is too small.
    (RECOVERED, "Agent Engine write hit the quota; retried", re.compile(r"Agent Engine append quota hit; retry")),
    (PROBLEM, "Google quota exhausted; the student was told to wait (raise the quota?)", re.compile(r"busy: Google quota exhausted")),
    (RECOVERED, "model stalled before its first token; retried", re.compile(r"MODEL_SILENT_STALL \(attempt")),
    (RECOVERED, "model rate-limited before its first token; retried", re.compile(r"MODEL_RATE_LIMITED \(attempt")),
    (RECOVERED, "model failed; fell over to the fallback model", re.compile(r"failed \(\w+, \d+ attempt\(s\)\) — falling over")),
    (RECOVERED, "teaching-goal lint timed out; the activity saved without lint hints", re.compile(r"goal-lint: degraded")),
    (
        KNOWN,
        "Gemini calls are not traced: opentelemetry-instrumentation-google-genai 0.x predates google-genai 2.x "
        "(1.x supports it; a tracing behaviour change, so not taken as cleanup)",
        re.compile(r"GoogleGenAiSdkInstrumentor only instruments"),
    ),
    (
        LOOK,
        "sim checker at capacity: a check was turned away (max 3 at once; the app retries, then says busy)",
        re.compile(r"aborted after waiting too long for an available instance"),
    ),
    (
        NOISE,
        "library notices printed once per instance start (experimental/deprecation warnings)",
        re.compile(
            r"UserWarning|FutureWarning|DeprecationWarning|ExperimentalWarning|warnings\.warn\(|--trace-warnings|"
            r"Duplicate Operation ID"
        ),
    ),
    # Browser errors are reported in their own section from aipla_client_error.
    (SKIP, "", re.compile(r"^WARNING:observability\.client_error:")),
]

_UVICORN_ACCESS = re.compile(r'"(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) (\S+) HTTP/[\d.]+" (\d{3})')


def _path(url: str) -> str:
    return re.sub(r"^https?://[^/]+", "", url).split("?", 1)[0] or "/"


def _norm(text: str) -> str:
    text = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "<uuid>", text)
    text = re.sub(r"/[0-9A-Za-z_-]{12,}", "/<id>", text)
    return re.sub(r"\d+", "N", text).replace("\n", " / ")[:160]


def classify_http(status: int, method: str, url: str) -> tuple[str, str]:
    path = _path(url)
    if status >= 500:
        return PROBLEM, f"HTTP {status} {method} {_norm(path)}"
    for kind, label, rx, statuses in _HTTP_RULES:
        if status in statuses and rx.search(path):
            return kind, label
    if status == 404 and (_PROBE.search(path) or not _APP_PATH.search(path)):
        return NOISE, "bot probes for files the app does not have (all answered 404)"
    if status < 400:
        return SKIP, ""
    return LOOK, f"HTTP {status} {method} {_norm(path)}"


def classify_text(text: str, severity: str) -> tuple[str, str]:
    m = _UVICORN_ACCESS.search(text)
    if m:
        status = int(m.group(3))
        return classify_http(status, m.group(1), m.group(2)) if status >= 400 else (SKIP, "")
    for kind, label, rx in _TEXT_RULES:
        if rx.search(text):
            return kind, label
    first = text.strip().splitlines()[0] if text.strip() else text
    if severity in ("ERROR", "CRITICAL", "ALERT", "EMERGENCY") or re.match(r"(ERROR|CRITICAL):", first) or "Traceback" in text:
        return PROBLEM, _norm(first)
    if severity == "WARNING" or first.startswith("WARNING:"):
        return LOOK, _norm(first)
    return SKIP, ""


def classify(entry: dict) -> tuple[str, str]:
    """One Cloud Logging entry → (kind, label). Pure, so the rules are testable."""
    sev = entry.get("severity", "DEFAULT")
    http = entry.get("httpRequest")
    if http and http.get("status"):
        return classify_http(int(http["status"]), http.get("requestMethod", ""), http.get("requestUrl", ""))
    text = entry.get("textPayload")
    if text is None:
        payload = entry.get("jsonPayload") or {}
        text = payload.get("message") or json.dumps(payload)[:400]
    return classify_text(text, sev)


def summarise(entries: list[dict]) -> dict[str, collections.Counter]:
    seen: set[str] = set()
    out: dict[str, collections.Counter] = {k: collections.Counter() for k in (PROBLEM, LOOK, RECOVERED, KNOWN, NOISE)}
    for e in entries:
        key = e.get("insertId") or json.dumps(e, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        kind, label = classify(e)
        if kind != SKIP:
            out[kind][f"{e.get('resource', {}).get('labels', {}).get('service_name', '?')}: {label}"] += 1
    return out


# ─── reading ────────────────────────────────────────────────────────────────


class ReadFailed(RuntimeError):
    pass


def _read(project: str, flt: str, limit: int) -> list[dict]:
    cmd = ["gcloud", "logging", "read", flt, f"--project={project}", f"--limit={limit}", "--format=json"]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise ReadFailed(proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else f"exit {proc.returncode}")
    return json.loads(proc.stdout or "[]")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("env", choices=sorted(PROJECTS))
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--limit", type=int, default=5000, help="max entries per read")
    args = ap.parse_args(argv)

    project = PROJECTS[args.env]
    since = (datetime.now(timezone.utc) - timedelta(hours=args.hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    base = f'resource.type="cloud_run_revision" AND timestamp>="{since}"'
    account = os.environ.get("CLOUDSDK_CORE_ACCOUNT") or subprocess.run(
        ["gcloud", "config", "get-value", "account"], capture_output=True, text=True
    ).stdout.strip()
    print(f"== log health: {args.env} ({project}), last {args.hours}h, as {account or '(no account)'}")

    try:
        warned = _read(project, f"{base} AND severity>=WARNING", args.limit)
        # Python logging goes to stdout with no severity; pick its WARNING/ERROR lines by text.
        plain = _read(
            project,
            f'{base} AND severity<WARNING AND NOT httpRequest.requestUrl:* AND '
            f'textPayload:("WARNING:" OR "ERROR:" OR "CRITICAL:" OR "Traceback" OR "Error:" OR "Warning")',
            args.limit,
        )
        browser = _read(project, f'logName:"aipla_client_error" AND timestamp>="{since}"', 500)
        checks = _read(
            project, f'{base} AND resource.labels.service_name="aipla-v01-sim-verify" AND jsonPayload.verify:*', 500
        )
    except ReadFailed as exc:
        print(f"\nCANNOT READ the logs ({exc}). No verdict. Check the gcloud account has logging access to {project}.")
        return 2
    capped = [n for n, rows in (("warnings", warned), ("app lines", plain)) if len(rows) >= args.limit]

    groups = summarise(warned + plain)
    titles = {
        PROBLEM: "PROBLEMS — start here",
        LOOK: "LOOK AT — not on the known list",
        RECOVERED: "RECOVERED — handled by the app",
        KNOWN: "KNOWN — understood, tracked",
        NOISE: "NOISE — expected, one line per kind",
    }
    for kind, title in titles.items():
        rows = groups[kind]
        print(f"\n{title} ({sum(rows.values())})")
        for label, n in rows.most_common(25 if kind != NOISE else 40):
            print(f"  {n:6d}  {label}")
        if not rows:
            print("       —")

    print(f"\nBROWSER ERRORS ({len(browser)})")
    bc: collections.Counter = collections.Counter()
    for e in browser:
        p = e.get("jsonPayload", {})
        bc[f"{p.get('app_version', '?')} {p.get('kind', '?')} {p.get('role', '?')} {p.get('path', '')[:40]} — {_norm(p.get('message') or '')[:90]}"] += 1
    for label, n in bc.most_common(20):
        print(f"  {n:6d}  {label}")
    if not browser:
        print("       —")

    ok = [e for e in checks if (e.get("jsonPayload") or {}).get("ok")]
    print(f"\nSIM CHECKS {len(ok)}/{len(checks)} finished")
    for e in checks:
        p = e.get("jsonPayload") or {}
        if not p.get("ok"):
            print(f"  {e['timestamp'][:16]}  {p.get('seconds')}s gl={p.get('gl')}  {p.get('why')}")

    if capped:
        print(f"\n⚠ {', '.join(capped)} hit --limit={args.limit}; counts are a floor. Re-run with a larger --limit or fewer --hours.")
    problems = sum(groups[PROBLEM].values())
    print(f"\nVERDICT: {'PROBLEMS FOUND' if problems else 'healthy'} ({problems} problem lines)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
