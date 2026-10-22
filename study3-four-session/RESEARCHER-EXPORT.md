# Study 3 researcher exports (technical preview only)

## Shared project navigation

`/studies/` lists the three studies; `/admin` retains the original Study1/2 export
buttons and original download/invitation script, adding an isolated Study3 section.
Over HTTPS the Study3 researcher page embeds same-origin; its cookie stays scoped to
`/study3/researcher/` and does not authorize old study exports. Over HTTP only a link
to the encrypted manager is shown, not a plaintext password form. The original
Study1/2 API routes and process remain unchanged. The gateway reads only the original
static `/admin` HTML from loopback, never its database, export token or answers.
The seven existing Study3 preview URLs and private storage do not move or reset.

Local integration tests: `node --test project-portal.test.mjs` use the repository's
original server source without starting its database. Server acceptance is
`node project-portal-acceptance.mjs`, comparing the live original admin script and
download button IDs against both HTTP/HTTPS unified pages. It never reads old exports.

`/study3/researcher/` provides password-protected overview and bulk ZIP / JSON downloads.
It is enabled only with an HTTPS public origin. There is no anonymous batch export.
Student number-only preview entries remain separate from administrator authentication.

Run `S3_DATA_DIR=/private/study3 node researcher-setup.mjs` once on the server.
This creates a random password in `researcher-access.txt` and a scrypt verifier in
`researcher-password.json`, both mode0600 inside the private data directory. Neither
file belongs in GitHub or public downloads. Login sessions are Secure/HttpOnly/
SameSite cookies, expire after 30 minutes, and are invalidated by restart/logout.
Failed-login rate limiting and a password-free audit log are included. Recovery or
credential rotation is an operator action; the setup command refuses overwrites.

ZIP contains UTF-8 BOM CSV overview, per-item long data, per-person three-wave wide
data, training records, practice / actual trials, events / checks / visits, item
dictionary, complete original JSON, a manifest and Chinese README. Missing and
not-started states stay explicit. CSV formula prefixes are escaped; JSON preserves
original strings. Snapshot reads do not change answers, groups or earlier revisions.
All files retain TECHNICAL_PREVIEW identity; raw DEMO labels are not silently rewritten.

Node24 tests: `node --test cloud-preview.test.mjs researcher-export.test.mjs`.
`researcher-acceptance.mjs` performs a server-local HTTPS login and export, checks ZIP
with the system unzip implementation, matches every original state and verifies the
answer database is unchanged. Outputs stay in a private timestamped data subfolder;
only verification metadata prints. This does not replace external-network acceptance.

Deploy uses a dedicated IP certificate (Certbot5.4 webroot, shortlived profile),
`study3-https.nginx.conf`, and certificate-renewal systemd unit/timer. The public cloud
firewall must allow TCP443; do not bypass certificate warnings or enable HTTP admin
login to work around it. Legacy HTTP virtual student previews can remain functional
using nginx-overwritten transport headers; the service must remain loopback-only.
Use the redirect snippet only once external HTTPS has passed, not before.

Reference: https://letsencrypt.org/2026/03/11/shorter-certs-certbot

Formal collection is not enabled by these changes. Use validated code in a separately
provisioned formal environment after complete student flow, timing and privacy checks;
never relabel or migrate technical fixtures into formal participant records.
