-- 1.1.149 M0 / M6 — does the tutor send the student to the workbench?
--
-- Design: docs/design/aipla/v1.1.0-feedback/tutor-directs-to-workbench.md
-- READ-ONLY, against `aipla-prod-2026.chat_logs`. Assistant rows have
-- role = 'tutor' (NOT 'assistant' — that filter returns zero rows silently).
--
-- ⚠️ The lexicon below is a MIRROR of backend/analytics/workbench_referral.py
-- GENERIC_PATTERN. The runtime nudge, the bench probe and this query must count
-- the same thing, so tests/unit/test_workbench_referral.py fails if the two
-- differ. Edit the Python constant, then paste it here.
--
-- M6 re-measure: change the date literals to the first classroom week after
-- the release and run Q1 again.

DECLARE ref_re STRING DEFAULT r'(?i)\b(arbejdsbord\w*|arbejdsflade\w*|arbejdsfelt\w*|workbench|simulering\w*|simulation\w*|simulator\w*|simmen|tabel\w*|table|graf\w*|chart|diagram\w*|kurve\w*|lommeregner\w*|beregner\w*|calculator|tjekliste\w*|checklist\w*|skriveflade\w*|skrivefelt\w*|begrebskort\w*|concept map|mission\w*|boldkast|kinebot|planck|interferens|faseovergang\w*|elkedel\w*|elmåler\w*|bølgefart|sekantbænk\w*|sol, jord)\b';

-- Q1 seminar day, per activity: how often do tutor turns refer to the bench?
WITH t AS (
  SELECT *, CASE WHEN STARTS_WITH(group_id, 'preview-') THEN 'teacher-trial'
                 WHEN STARTS_WITH(group_id, 'teacher:') OR STARTS_WITH(group_id, 'preview:') THEN 'excluded'
                 ELSE 'student-group' END AS who
  FROM `aipla-prod-2026.chat_logs.chat_turns`
  WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05'),
tut AS (
  SELECT *, REGEXP_CONTAINS(content, ref_re) AS ref,
         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY turn_index, ts) AS k
  FROM t WHERE role = 'tutor' AND who != 'excluded'),
per_session AS (
  SELECT session_id, ANY_VALUE(activity_id) activity_id, ANY_VALUE(who) who,
         ANY_VALUE(framework_id) framework_id, ANY_VALUE(app_version) app_version,
         COUNT(*) tutor_turns, COUNTIF(ref) ref_turns, MIN(IF(ref, k, NULL)) first_ref_k
  FROM tut GROUP BY session_id)
SELECT activity_id, who, framework_id, app_version,
       COUNT(*) sessions, SUM(tutor_turns) tutor_turns, SUM(ref_turns) ref_turns,
       ROUND(SAFE_DIVIDE(SUM(ref_turns), SUM(tutor_turns)), 3) ref_share,
       COUNTIF(ref_turns > 0) sessions_with_ref,
       APPROX_QUANTILES(first_ref_k, 2)[OFFSET(1)] median_first_ref_turn
FROM per_session GROUP BY 1, 2, 3, 4 ORDER BY sessions DESC;

-- Q2 baseline: the same, per ISO week, 2026-09-07 .. 2026-10-04 (student groups only).
SELECT EXTRACT(ISOWEEK FROM ts) wk, activity_id,
       COUNT(DISTINCT session_id) sessions, COUNTIF(role = 'tutor') tutor_turns,
       COUNTIF(role = 'tutor' AND REGEXP_CONTAINS(content, ref_re)) ref_turns,
       COUNT(DISTINCT IF(role = 'tutor' AND REGEXP_CONTAINS(content, ref_re), session_id, NULL)) sessions_with_ref
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') BETWEEN '2026-09-07' AND '2026-10-04'
  AND NOT (STARTS_WITH(group_id, 'teacher:') OR STARTS_WITH(group_id, 'preview'))
GROUP BY 1, 2 HAVING sessions >= 3 ORDER BY wk, sessions DESC;

-- Q3 did students use the bench anyway, and did control_sim ever fire? (seminar day)
SELECT w.activity_id, COUNT(DISTINCT w.session_id) sessions_with_events,
       COUNTIF(w.tool = 'control_sim') tutor_sim_commands,
       COUNT(*) events, STRING_AGG(DISTINCT w.server LIMIT 10) servers
FROM `aipla-prod-2026.chat_logs.workbench_events` w
WHERE DATE(w.ts, 'Europe/Copenhagen') = '2026-10-05'
GROUP BY 1 ORDER BY events DESC;

-- Q4 qualitative: 40 tutor turns from the busiest workbench activity (fill in from Q3).
SELECT session_id, turn_index, REGEXP_CONTAINS(content, ref_re) ref, SUBSTR(content, 1, 400) content
FROM `aipla-prod-2026.chat_logs.chat_turns`
WHERE DATE(ts, 'Europe/Copenhagen') = '2026-10-05' AND role = 'tutor' AND activity_id = '<from Q3>'
ORDER BY session_id, turn_index LIMIT 40;
