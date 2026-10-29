#!/usr/bin/env bash
set -euo pipefail
release_id=${1:?12-character revision required}
[[ "$release_id" =~ ^[a-f0-9]{12}$ ]] || exit 2
target="/var/www/study3-preview/releases/$release_id"
source_dir=$(readlink /var/www/study3-preview/current)
[[ "$source_dir" =~ ^/var/www/study3-preview/releases/[a-f0-9]{12}$ ]] || exit 2
[[ ! -e "$target" ]] || exit 2
sudo cp -a "$source_dir" "$target"
sudo tar -xzf /tmp/study3-pilot-followup-20261029.tar.gz -C "$target"
sudo chown -R root:root "$target"
node_bin=/opt/study3-runtime/node-v24.22.0-linux-x64/bin/node
(cd "$target" && "$node_bin" --test cohort.test.mjs cloud-preview.test.mjs researcher-export.test.mjs)
drop_dir=/etc/systemd/system/study3-cohort@pilot.service.d
drop="$drop_dir/followup-24h.conf"
sudo test ! -e "$drop"
old_pilot_pid=$(systemctl show -p MainPID --value study3-cohort@pilot)
formal_pid=$(systemctl show -p MainPID --value study3-cohort@formal)
technical_pid=$(systemctl show -p MainPID --value study3-preview)
formal_hash=$(sha256sum /var/lib/study3-formal/study3.sqlite | cut -d' ' -f1)
sudo install -d -m 0755 "$drop_dir"
sudo systemctl stop study3-cohort@pilot
restore_service(){ sudo rm -f "$drop"; sudo systemctl daemon-reload; sudo systemctl start study3-cohort@pilot; }
trap restore_service ERR
# Backup stays on this server in the private PILOT directory. No answers exported.
mkdir -p /var/lib/study3-pilot/backups
chmod 0700 /var/lib/study3-pilot/backups
cp -p /var/lib/study3-pilot/study3.sqlite "/var/lib/study3-pilot/backups/before-followup-$release_id.sqlite"
before=$(sha256sum /var/lib/study3-pilot/study3.sqlite | cut -d' ' -f1)
printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=%s %s/cohort-server.mjs\n' "$target" "$node_bin" "$target" | sudo tee "$drop" >/dev/null
sudo systemctl daemon-reload
sudo systemctl start study3-cohort@pilot
for attempt in {1..20}; do
 if curl --fail --silent -H 'Host: 101.34.238.243' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8786/study3/pilot/health >/tmp/study3-pilot-followup-health.json; then break; fi
 sleep 0.2
done
"$node_bin" --input-type=module -e 'import{readFileSync}from"node:fs";const h=JSON.parse(readFileSync("/tmp/study3-pilot-followup-health.json"));if(!h.ok||h.followup_policy.followup_days!==1)process.exit(1);'
after=$(sha256sum /var/lib/study3-pilot/study3.sqlite | cut -d' ' -f1)
[[ "$before" == "$after" ]] || { echo 'PILOT database changed during startup; inspect concurrent activity (never restore over answers).'; exit 1; }
[[ "$formal_pid" == "$(systemctl show -p MainPID --value study3-cohort@formal)" ]]
[[ "$technical_pid" == "$(systemctl show -p MainPID --value study3-preview)" ]]
[[ "$formal_hash" == "$(sha256sum /var/lib/study3-formal/study3.sqlite | cut -d' ' -f1)" ]]
trap - ERR
systemctl is-active study3-cohort@pilot study3-cohort@formal study3-preview
printf 'PILOT follow-up deployed; original PILOT database bytes unchanged. Formal and technical processes unchanged.\n'
printf 'Release: %s; previous PILOT process: %s\n' "$release_id" "$old_pilot_pid"
