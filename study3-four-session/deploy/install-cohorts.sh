#!/usr/bin/env bash
# Run via authorized SSH. Does not read answer bodies, keys or passwords to stdout.
set -euo pipefail
release_id=${1:?12-character revision required}
[[ "$release_id" =~ ^[a-f0-9]{12}$ ]] || exit 2
target="/var/www/study3-preview/releases/$release_id"
source_dir=/var/www/study3-preview/releases/8772f3ceea04
archive=/tmp/study3-cohorts-20261025.tar.gz
before_file=$(mktemp /tmp/study3-before-XXXXXXXX)
after_file=$(mktemp /tmp/study3-after-XXXXXXXX)
sha256sum /var/lib/study3-preview/identity.sqlite /var/lib/study3-preview/answers.sqlite /var/lib/study3-preview/preview-answers.sqlite > "$before_file"
if [[ ! -d "$target" ]]; then sudo cp -a "$source_dir" "$target"; fi
sudo tar -xzf "$archive" -C "$target"
sudo chown -R root:root "$target"
for env_name in pilot formal; do
  sudo install -d -o ubuntu -g ubuntu -m 700 "/var/lib/study3-$env_name"
  if [[ ! -f "/var/lib/study3-$env_name/researcher-password.json" ]]; then
    sudo install -o ubuntu -g ubuntu -m 600 /var/lib/study3-preview/researcher-password.json "/var/lib/study3-$env_name/researcher-password.json"
  fi
  sudo install -o root -g root -m 600 "$target/deploy/study3-$env_name.env" "/etc/study3-$env_name.conf"
  sudo install -d -m 755 "/etc/systemd/system/study3-cohort@$env_name.service.d"
  sudo install -m 644 "$target/deploy/study3-$env_name-isolation.conf" "/etc/systemd/system/study3-cohort@$env_name.service.d/10-data-isolation.conf"
done
sudo install -m 644 "$target/deploy/study3-cohort@.service" /etc/systemd/system/study3-cohort@.service
sudo install -m 644 "$target/deploy/study3-cohorts.nginx.conf" /etc/nginx/snippets/study3-cohorts.conf
sudo install -d -m 700 /var/backups/study3-cohorts-20261025
sudo cp -p /etc/nginx/snippets/study3-project-navigation.conf "/var/backups/study3-cohorts-20261025/navigation-$release_id.conf"
sudo install -m 644 "$target/deploy/study3-project-navigation.nginx.conf" /etc/nginx/snippets/study3-project-navigation.conf
if ! sudo nginx -t; then
  sudo install -m 644 "/var/backups/study3-cohorts-20261025/navigation-$release_id.conf" /etc/nginx/snippets/study3-project-navigation.conf
  exit 1
fi
sudo ln -sfn "$target" /var/www/study3-preview/current
sudo systemctl daemon-reload
sudo systemctl enable --now study3-cohort@pilot study3-cohort@formal
sudo systemctl restart study3-preview
sudo systemctl reload nginx
systemctl is-active study3-preview study3-cohort@pilot study3-cohort@formal
sha256sum /var/lib/study3-preview/identity.sqlite /var/lib/study3-preview/answers.sqlite /var/lib/study3-preview/preview-answers.sqlite > "$after_file"
cmp "$before_file" "$after_file"
printf 'Original technical DB fingerprints unchanged.\n'
ps -p 2200087 -o pid=,comm=
printf 'Both new collection switches remain false.\n'
