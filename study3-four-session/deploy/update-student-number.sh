#!/usr/bin/env bash
set -euo pipefail
release_id=${1:?12-character revision required}
[[ "$release_id" =~ ^[a-f0-9]{12}$ ]] || exit 2
target="/var/www/study3-preview/releases/$release_id"
source_dir=$(readlink /var/www/study3-preview/current)
[[ "$source_dir" =~ ^/var/www/study3-preview/releases/[a-f0-9]{12}$ ]] || exit 2
before=$(mktemp /tmp/study3-number-before-XXXXXXXX)
after=$(mktemp /tmp/study3-number-after-XXXXXXXX)
sha256sum /var/lib/study3-preview/identity.sqlite /var/lib/study3-preview/answers.sqlite /var/lib/study3-preview/preview-answers.sqlite > "$before"
if [[ ! -d "$target" ]]; then sudo cp -a "$source_dir" "$target"; fi
sudo tar -xzf /tmp/study3-student-number-20261025.tar.gz -C "$target"
sudo chown -R root:root "$target"
sudo ln -sfn "$target" /var/www/study3-preview/current
# Existing enabled flags and stores are kept; no code issuance or data rewrite.
sudo systemctl restart study3-preview study3-cohort@pilot study3-cohort@formal
systemctl is-active study3-preview study3-cohort@pilot study3-cohort@formal
sha256sum /var/lib/study3-preview/identity.sqlite /var/lib/study3-preview/answers.sqlite /var/lib/study3-preview/preview-answers.sqlite > "$after"
cmp "$before" "$after"
printf 'Student-number UI deployed; original technical databases unchanged.\n'
ps -p 2200087 -o pid=,comm=
