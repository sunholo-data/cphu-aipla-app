#!/usr/bin/env bash
# check-custom-domains.sh — is the ku.dk cutover actually complete?
#
# WHY THIS EXISTS. When UCPH IT create the DNS records, most of the chain comes
# up on its own: the names resolve, the Google-managed certificates go ACTIVE
# without being asked, HTTPS serves, the HTTP->HTTPS redirect works, and teacher
# sign-in works because `authorized_domains` is live config that needed no
# redeploy.
#
# One thing does NOT come up on its own, and it fails INVISIBLY:
#
#   The sandbox reads ALLOWED_HOST_ORIGINS at DEPLOY time. Terraform updated the
#   Cloud Build trigger's substitution, but the RUNNING service keeps the value
#   it was deployed with — the *.run.app frontend only. Until the sandbox is
#   redeployed (a `v*` tag on test, a promote on prod), every simulation
#   embedded from https://aipla.ku.dk is refused as an unrecognised embedder.
#
# So the failure mode is: the site loads, sign-in works, teachers browse happily
# — and Boldkast, KineBot and LED-Planck are dead. Nothing alerts anyone,
# because every service is healthy and every smoke check passes. "It looks like
# it works" is precisely the state this script exists to distinguish from "it
# works".
#
# Usage:
#   ./scripts/check-custom-domains.sh            # test + prod
#   ./scripts/check-custom-domains.sh prod
#
# Read-only. Safe to run repeatedly while waiting on UCPH IT.
set -uo pipefail

ENVS=("$@")
[ $# -eq 0 ] && ENVS=(test prod)

fail=0
pending=0

for ENV in "${ENVS[@]}"; do
  case "${ENV}" in
    test)
      PROJECT="aipla-test-2026"; APP="aipla-test.ku.dk"; SANDBOX="aipla-test-sandbox.ku.dk"
      EXPECT_V4="136.68.144.79" ;;
    prod)
      PROJECT="aipla-prod-2026"; APP="aipla.ku.dk"; SANDBOX="aipla-sandbox.ku.dk"
      EXPECT_V4="8.233.216.35" ;;
    *) echo "Unknown env: ${ENV} (use test|prod)" >&2; exit 2 ;;
  esac

  echo "== ${ENV} (${PROJECT})"

  # 1. DNS — the thing UCPH IT control, and the gate on everything below.
  #
  # THREE STATES, NOT TWO. A plain `dig` returns nothing both when the record
  # was never created AND when it exists but fails DNSSEC validation. On
  # 2026-08-10 that ambiguity cost a day: UCPH IT had created all four records
  # correctly, with the right IPs, but ku.dk had not been re-signed since
  # 2026-07-30. So the parent zone served a signed NSEC proof that the names did
  # NOT exist, while ns1/ns2 simultaneously answered A queries for them.
  # Validating resolvers call that forged and refuse (Google — and therefore
  # Google's certificate prober, which is why the certs sat at
  # FAILED_NOT_VISIBLE); lenient ones return the record (UCPH's own resolver,
  # Cloudflare), which is why IT could not reproduce it and closed the ticket.
  #
  # So query TWICE — once with +cd to see whether the DATA exists, once normally
  # to see whether it VALIDATES — and name the difference instead of collapsing
  # both into "not yet". The parent-side DS query is the tiebreaker and is the
  # one piece of evidence that needs no third-party tool:
  #
  #   dig @ns1.ku.dk +norec science.ku.dk DS   -> NOERROR  (exists, no DS: fine)
  #   dig @ns1.ku.dk +norec aipla.ku.dk   DS   -> NXDOMAIN (not in signed data)
  for NAME in "${APP}" "${SANDBOX}"; do
    # +cd = checking disabled: the raw data, whatever its DNSSEC status.
    RAW="$(dig +cd +short "${NAME}" A 2>/dev/null | grep -E '^[0-9]' | head -1)"
    # No +cd: what a validating resolver is willing to hand a user.
    GOT="$(dig +short "${NAME}" A 2>/dev/null | grep -E '^[0-9]' | head -1)"

    if [ -z "${RAW}" ]; then
      echo "  .... ${NAME} has no record at all (waiting on UCPH IT to create it)"
      pending=1
    elif [ "${RAW}" != "${EXPECT_V4}" ]; then
      echo "  FAIL ${NAME} -> ${RAW}, expected ${EXPECT_V4}"
      fail=1
    elif [ -n "${GOT}" ]; then
      echo "  ok   ${NAME} -> ${GOT}"
    else
      # The record is right but validating resolvers refuse it. Report the
      # parent's own verdict so the next person does not have to re-derive it.
      DS_STATUS="$(dig +time=5 +tries=1 @ns1.ku.dk +norec "${NAME}" DS 2>/dev/null \
                   | grep -oE 'status: [A-Z]+' | head -1 | awk '{print $2}')"
      echo "  .... ${NAME} -> ${RAW} but FAILS DNSSEC validation (ku.dk not re-signed)"
      echo "         record is CORRECT; the delegation is not inside ku.dk's signatures."
      echo "         ns1.ku.dk says '${NAME} DS' -> ${DS_STATUS:-unknown} (NXDOMAIN = not in signed data)"
      echo "         Certificates cannot issue until this clears. UCPH IT must re-sign ku.dk."
      pending=1
    fi
  done

  # Zone context. NOTE: do NOT read the inception date as "has it been
  # re-signed?" — on 2026-08-11 UCPH re-signed ku.dk with the NSEC chain
  # regenerated (aipla.ku.dk and aipla-test.ku.dk went from NXDOMAIN to NOERROR
  # on the parent DS query) while the inception stayed at 20260730000000,
  # because their signer uses a fixed validity window rather than stamping each
  # run. The per-name parent-DS verdict above is the signal that actually
  # tracks reality; this is background only.
  KU_INC="$(dig +cd +dnssec ku.dk SOA +noall +answer 2>/dev/null \
            | awk '/RRSIG/ {print $10; exit}')"
  KU_EXP="$(dig +cd +dnssec ku.dk SOA +noall +answer 2>/dev/null \
            | awk '/RRSIG/ {print $9; exit}')"
  [ -n "${KU_INC}" ] && echo "  info ku.dk signature window ${KU_INC} -> ${KU_EXP} (fixed dates; does NOT move on every re-sign)"

  # 2. Certificates. These need no action — they issue once the names resolve
  #    here. One per hostname deliberately, so a missing sandbox record cannot
  #    hold the frontend's certificate hostage.
  while read -r CERT STATUS; do
    [ -z "${CERT}" ] && continue
    case "${STATUS}" in
      ACTIVE) echo "  ok   cert ${CERT} ACTIVE" ;;
      PROVISIONING) echo "  .... cert ${CERT} PROVISIONING (normal until DNS resolves; then 15-60min)"; pending=1 ;;
      *) echo "  FAIL cert ${CERT} ${STATUS}"; fail=1 ;;
    esac
  done < <(gcloud compute ssl-certificates list --global --project="${PROJECT}" \
             --format="value(name,managed.status)" 2>/dev/null)

  # 3. Does HTTPS actually serve, and does bare http:// redirect rather than
  #    hang? The redirect is why someone typing the hostname without a scheme
  #    gets the site instead of a connection refused.
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${APP}/" 2>/dev/null)"
  case "${CODE}" in
    200) echo "  ok   https://${APP}/ -> 200" ;;
    000) echo "  .... https://${APP}/ not serving yet"; pending=1 ;;
    *)   echo "  FAIL https://${APP}/ -> ${CODE}"; fail=1 ;;
  esac

  RCODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://${APP}/" 2>/dev/null)"
  if [ "${RCODE}" = "301" ] || [ "${RCODE}" = "308" ]; then
    echo "  ok   http://${APP}/ -> ${RCODE} redirect"
  elif [ "${RCODE}" = "000" ]; then
    echo "  .... http://${APP}/ not serving yet"; pending=1
  else
    echo "  FAIL http://${APP}/ -> ${RCODE} (expected a redirect)"; fail=1
  fi

  # 4. THE ONE THAT FAILS SILENTLY. Compare the DEPLOYED sandbox env var against
  #    the origin the app will actually be served from. This is a property of
  #    the running revision, not of Terraform state — which is the entire point,
  #    since Terraform can be perfectly up to date while the service is not.
  ORIGINS="$(gcloud run services describe aipla-v01-sandbox --region=europe-north1 \
    --project="${PROJECT}" --format='value(spec.template.spec.containers[0].env)' 2>/dev/null \
    | tr ';' '\n' | grep -A0 'ALLOWED_HOST_ORIGINS' || true)"
  if echo "${ORIGINS}" | grep -q "https://${APP}"; then
    echo "  ok   sandbox accepts https://${APP} as an embedder"
  else
    echo "  FAIL sandbox does NOT accept https://${APP} — sims will be blocked."
    echo "         The deployed revision predates the origin change. Redeploy it:"
    echo "           test: git tag -a vX.Y.Z && git push origin vX.Y.Z"
    echo "           prod: make promote VERSION=vX.Y.Z FROM=test TO=prod GO=1"
    fail=1
  fi
done

echo
if [ "${fail}" -ne 0 ]; then
  echo "custom domains: FAIL — see above"
  exit 1
fi
if [ "${pending}" -ne 0 ]; then
  echo "custom domains: PENDING — waiting on DNS/certificates, nothing to do"
  exit 0
fi
echo "custom domains: OK"
