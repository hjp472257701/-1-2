# Study 3 isolated cloud technical preview

This release does NOT enable formal data collection. Use virtual codes beginning
with `CLOUDTEST-` (4–20 more letters, digits or hyphens), never student IDs or names.
All records retain the technical-preview/non-research-data identity. Only the
seven independent `/study3/try/` entries are exposed. The cloud hub is `/study3/`.

## Runtime

Use a dedicated Node 24 installation with `node:sqlite`; do not replace the Node
20 runtime used by studies 1/2. No npm packages are required for this service.

```
S3_PUBLIC_ORIGIN=http://YOUR_APPROVED_HOST
S3_DATA_DIR=/var/lib/study3-preview
S3_CLOUD_PORT=8785
node cloud-preview.mjs
```

The gateway and inner preview backend bind only to 127.0.0.1. Nginx forwards only
`/study3/` to port 8785, preserving the original request Host. Set the exact public
origin; unrecognized Host, cross-origin POST, query strings, other APIs and code
or data files are rejected. Do not expose port 8785 directly to the network.
HTTP is for virtual, nonsensitive technical testing only. HTTPS, participant
authorization, consent/contact/withdrawal policy, safety review and complete
real-user testing must be addressed before any real participants or formal data.

Cookie name is `s3cloudpreview`, scoped to `/study3/`, HttpOnly and SameSite=Strict;
Secure is added for HTTPS. Cloud tests have separate persistent storage, not the
local .data directory or the databases used by studies 1/2. Never publish storage,
identity keys, .env, credentials, logs or real responses to GitHub.

The gateway rate-limits entering previews and caps technical assignments at 200.
It does not delete records at capacity. Public virtual codes are not participant
authentication. Record the exact release commit and back up the private directory
with its identity key before maintenance. Backups must stay outside public paths.

## Test and deployment

Run `node --test cloud-preview.test.mjs` for standalone cloud-gateway checks.
Other historical tests may depend on manuscript fixtures outside this code repo;
they are run in the thesis workspace, not represented as self-contained here.
Keep the original local server and source/model/measurement definitions intact.

Use an immutable release directory, an independent `study3-preview.service`, and
a dedicated nginx location snippet. Run `nginx -t` before reloading. Do not restart
the existing PM2 `thesis` application. Roll back by stopping only study3-preview
and removing only its nginx include after validation; keep records and releases.
