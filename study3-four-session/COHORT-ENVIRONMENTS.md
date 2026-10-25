# Study 3 independent longitudinal environments (2026-10-25)

Technical /study3/try/* and its data stay unchanged. New routes reuse the same
approved CONTENT_V9, scoring and training actions, but use cohort-server.mjs,
cohort-store.mjs and cohort-export.mjs. The historical sibling study3-pilot/
is a single-session local demo and is NOT this new environment.

Routes: /study3/pilot/{pre,practice-1,practice-2,practice-3,practice-4,mid,post}/
and the same seven under /study3/formal/. Participant pages do not list other
entries. Researcher entry/summary/ZIP/JSON are under each base's researcher/.
The original /admin embeds independent management panels; no Study 1/2 DB access.

Each environment needs a different real data directory, containing a frozen
environment.json, private cohort-key, study3.sqlite and independent researcher
password verifier. Refuses old SQLite directory adoption, environment mismatch,
protocol mismatch, material mismatch or symlink data directory. Never import or
promote technical fixtures. One fresh state per issued number, not seven isolated
states. Enrollment allowlist stores HMAC only; raw high-entropy codes remain in a
private researcher file. No names/student IDs or arbitrary number registrations.
Unknown/mistyped number cannot create another participant. Same number can resume
in a fresh browser or after service restart; group randomizes once after baseline.

PILOT protocol: first training >=1 day after baseline, later courses at offsets
2,4,5 days from planned first course (about one active week). Explicitly compressed
and not dose-equivalent to FORMAL. Follow-up remains 14 days after actual last
course. FORMAL keeps baseline+2 days, first-course offsets 0/3/7/10, follow-up
actual fourth course+14 days. New cohort implementation requires prior courses
completed before later courses; no date override, no replay, no student exports
or destructive online withdrawal endpoint. Stop anytime; controlled withdrawal
is handled by contacting organizer. Any intention-to-treat/missed-class protocol
decision needs confirmation before FORMAL activation; never fabricate missed data.

Default deployment template: both closed. User confirmed on 2026-10-25 that
questions/withdrawal go through the organizing teacher and data are intended
to be retained until 2027. The pilot-open.env profile permits PILOT only after
that notice is deployed and accepted. No exact deletion date or automatic purge
is implied. FORMAL enabled=true is rejected by code, formal codes cannot
be issued by setup. Formal recruitment, sample size/inclusion, retention and
contact/consent procedures remain separate acceptance requirements. Pilot draft
participation text and protocol must be reviewed before its collection switch.

Latest 2026-10-25 authorization supersedes the preceding closed-stage note:
the user explicitly requested BOTH PILOT and FORMAL to be opened now, with
actual distribution at different planned dates. cohort-server now accepts an
enabled flag for either environment. open-cohorts.sh installs the two explicit
open profiles; the original generic installer still uses safe closed defaults.
Questions go via the organizing teacher. Student-facing contact text is exactly
“如果有疑问，可以告知老师，由老师帮忙反馈。” Retention until 2027 is a researcher
record, not a fabricated exact deletion date or scheduled purge. Participation
text is generic to both environments and is recorded per new participant.

New group allocation (not old technical groups): ordered by first completed
baseline, each pair is cryptographically randomized AB or BA; allocation and
the final baseline response are committed in one SQLite transaction. Every even
number of allocations has equal group counts; an incomplete pair differs by 1.
This is random permuted-pair block allocation, NOT independent Bernoulli sampling
and NOT fixed alternation by student number. Persisted groups never change on
refresh/restart. Completer/valid-sample counts may differ after dropout and are
not force-balanced or silently excluded. Report this actual method in the thesis.
Code pools (10 PILOT, 200 FORMAL) are capacity only, not sample-size calculations.

Latest student-number correction (2026-10-25): students enter their OWN student
number in the existing 测试号码 field, 4–24 digits/ASCII letters (leading zeros
preserved; full-width normalized; letters case-folded). No issued code needed.
The unused earlier code pools remain private for compatibility and are not sent.
New student numbers can enroll from PRE only with explicit confirmation/consent.
Only an environment-separated HMAC is persisted, never the raw student number in
answer JSON, CSV or logs; identifiers are not independently verified enrollment.

Do NOT treat a guessable student number as authorization to read past answers.
Normal entry uses an HttpOnly/Secure/SameSite=Strict device cookie (60-day grant,
hashed in the private store), plus the existing short session. Same device/browser
can fill the number again after pause/short-session expiry/service restart without
new signup or changing group. Unknown devices may NOT resume an existing student
number. A teacher reports the request; researcher verifies identity and runs:

    S3_ENVIRONMENT=PILOT S3_DATA_DIR=/var/lib/study3-pilot \
      S3_RECOVERY_OUTPUT=/private/recovery-unique.txt node cohort-recovery.mjs

Read the original student number from stdin, never a public URL/shell history.
The private output is a single-use 15-minute link, sent only to that participant.
They enter their original number there; existing state/group remains untouched.
Used/expired links do not work; successful recovery revokes prior device grants.
The fragment is removed after successful entry; it is not sent as an HTTP URL
parameter. Links and browser storage are still subject to device/browser policies;
clearing cookies/private browsing or changing devices requires teacher assistance.
Credentials are not in code. New management may reuse the existing Study 3 secret
by copying only its password verifier into each private data directory; sessions
and cookies remain path-scoped and independent. Never reuse Study 1/2 tokens.

Setup (on server, never print codes):

    S3_ENVIRONMENT=PILOT S3_DATA_DIR=/var/lib/study3-pilot \
      S3_CODES_OUTPUT=/var/lib/study3-pilot/enrollment-codes.txt \
      node cohort-setup.mjs

This issues 10 codes without creating answers or assigning groups. Never rerun
against an existing output; no destructive reset. Copy code file only through an
authorized private channel, not chat/GitHub. Configure services separately:

    S3_ENVIRONMENT=PILOT   # FORMAL for the other service
    S3_PUBLIC_ORIGIN=https://101.34.238.243
    S3_DATA_DIR=/var/lib/study3-pilot
    S3_COHORT_PORT=8786    # 8787 for formal
    S3_COLLECTION_ENABLED=false

Optional protected audit logs contain only generated request ID/event kind/time,
not code, request body, answer, password or IP. A rejection ID can help diagnose
failed requests; it is not proof of a network failure. Export retains raw answers,
timestamps, consent, protocol, material digest and zero/missing distinctions.
Material lineage retains existing DEMO version names; new data_role=PILOT/FORMAL
is explicitly separate. Empty exports contain headers and all item definitions.

Tests use temporary synthetic stores, not actual pilot/formal DBs. Technical,
pilot and formal exports must be accepted independently, with original technical
DB fingerprints and Study 1/2 process unchanged after deployment.
