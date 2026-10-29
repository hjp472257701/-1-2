#!/usr/bin/env bash
set -euo pipefail
release_id=${1:?12-character revision required}
[[ "$release_id" =~ ^[a-f0-9]{12}$ ]] || exit 2
target="/var/www/study3-preview/releases/$release_id"
source_dir=$(systemctl show -p WorkingDirectory --value study3-cohort@pilot)
[[ "$source_dir" =~ ^/var/www/study3-preview/releases/[a-f0-9]{12}$ ]] || exit 2
[[ ! -e "$target" ]] || exit 2
sudo cp -a "$source_dir" "$target"
sudo tar -xzf /tmp/study3-pilot-calendar-20261029.tar.gz -C "$target"
sudo chown -R root:root "$target"
node_bin=/opt/study3-runtime/node-v24.22.0-linux-x64/bin/node
(cd "$target" && "$node_bin" --test cohort.test.mjs cloud-preview.test.mjs researcher-export.test.mjs)
drop=/etc/systemd/system/study3-cohort@pilot.service.d/followup-24h.conf
sudo test -f "$drop"
old_drop=$(mktemp /tmp/study3-calendar-old-drop-XXXXXXXX)
sudo cat "$drop" > "$old_drop"
formal_pid=$(systemctl show -p MainPID --value study3-cohort@formal)
technical_pid=$(systemctl show -p MainPID --value study3-preview)
formal_hash=$(sha256sum /var/lib/study3-formal/study3.sqlite | cut -d' ' -f1)
sudo systemctl stop study3-cohort@pilot
restore_service(){ sudo cp "$old_drop" "$drop"; sudo systemctl daemon-reload; sudo systemctl start study3-cohort@pilot; }
trap restore_service ERR
mkdir -p /var/lib/study3-pilot/backups
chmod 0700 /var/lib/study3-pilot/backups
cp -p /var/lib/study3-pilot/study3.sqlite "/var/lib/study3-pilot/backups/before-calendar-$release_id.sqlite"
before=$(sha256sum /var/lib/study3-pilot/study3.sqlite | cut -d' ' -f1)
printf '[Service]\nWorkingDirectory=%s\nExecStart=\nExecStart=%s %s/cohort-server.mjs\n' "$target" "$node_bin" "$target" | sudo tee "$drop" >/dev/null
sudo systemctl daemon-reload
sudo systemctl start study3-cohort@pilot
for attempt in {1..20}; do
 if curl --fail --silent -H 'Host: 101.34.238.243' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8786/study3/pilot/health >/tmp/study3-pilot-calendar-health.json; then break; fi
 sleep 0.2
done
"$node_bin" --input-type=module -e 'import{readFileSync}from"node:fs";const h=JSON.parse(readFileSync("/tmp/study3-pilot-calendar-health.json"));if(!h.ok||h.calendar_policy.opens.post!=="2026-11-02T12:00:00.000Z")process.exit(1);'
after=$(sha256sum /var/lib/study3-pilot/study3.sqlite | cut -d' ' -f1)
[[ "$before" == "$after" ]] || { echo 'PILOT database changed during startup; inspect concurrent activity (never restore over answers).'; exit 1; }
[[ "$formal_pid" == "$(systemctl show -p MainPID --value study3-cohort@formal)" ]]
[[ "$technical_pid" == "$(systemctl show -p MainPID --value study3-preview)" ]]
[[ "$formal_hash" == "$(sha256sum /var/lib/study3-formal/study3.sqlite | cut -d' ' -f1)" ]]
trap - ERR
rm -f "$old_drop"
systemctl is-active study3-cohort@pilot study3-cohort@formal study3-preview
printf 'PILOT fixed calendar deployed; original database bytes unchanged. Formal and technical processes unchanged.\nRelease: %s\n' "$release_id"
