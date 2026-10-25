#!/usr/bin/env bash
# Both environments explicitly authorized for opening on 2026-10-25.
set -euo pipefail
release_id=${1:?12-character revision required}
[[ "$release_id" =~ ^[a-f0-9]{12}$ ]] || exit 2
target="/var/www/study3-preview/releases/$release_id"
source_dir=$(readlink /var/www/study3-preview/current)
[[ "$source_dir" =~ ^/var/www/study3-preview/releases/[a-f0-9]{12}$ ]] || exit 2
before=$(mktemp /tmp/study3-open-before-XXXXXXXX)
after=$(mktemp /tmp/study3-open-after-XXXXXXXX)
sha256sum /var/lib/study3-preview/identity.sqlite /var/lib/study3-preview/answers.sqlite /var/lib/study3-preview/preview-answers.sqlite > "$before"
if [[ ! -d "$target" ]]; then sudo cp -a "$source_dir" "$target"; fi
sudo tar -xzf /tmp/study3-both-open-20261025.tar.gz -C "$target"
sudo chown -R root:root "$target"
sudo install -d -m 700 /var/backups/study3-open-20261025
for env_name in pilot formal; do
 sudo cp -p "/etc/study3-$env_name.conf" "/var/backups/study3-open-20261025/$env_name-$release_id.conf"
 sudo install -o root -g root -m 600 "$target/deploy/study3-$env_name-open.env" "/etc/study3-$env_name.conf"
done
sudo ln -sfn "$target" /var/www/study3-preview/current
sudo systemctl restart study3-preview study3-cohort@pilot study3-cohort@formal
systemctl is-active study3-preview study3-cohort@pilot study3-cohort@formal
node_bin=/opt/study3-runtime/node-v24.22.0-linux-x64/bin/node
if [[ ! -f /var/lib/study3-pilot/enrollment-codes.txt ]]; then
 S3_ENVIRONMENT=PILOT S3_COLLECTION_ENABLED=true S3_DATA_DIR=/var/lib/study3-pilot S3_CODES_COUNT=10 S3_CODES_OUTPUT=/var/lib/study3-pilot/enrollment-codes.txt "$node_bin" "$target/cohort-setup.mjs"
fi
if [[ ! -f /var/lib/study3-formal/enrollment-codes.txt ]]; then
 S3_ENVIRONMENT=FORMAL S3_COLLECTION_ENABLED=true S3_DATA_DIR=/var/lib/study3-formal S3_CODES_COUNT=200 S3_CODES_OUTPUT=/var/lib/study3-formal/enrollment-codes.txt "$node_bin" "$target/cohort-setup.mjs"
fi
sha256sum /var/lib/study3-preview/identity.sqlite /var/lib/study3-preview/answers.sqlite /var/lib/study3-preview/preview-answers.sqlite > "$after"
cmp "$before" "$after"
printf 'Original technical DB fingerprints unchanged. Both cohort entry switches enabled.\n'
ps -p 2200087 -o pid=,comm=
