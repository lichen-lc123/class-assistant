#!/usr/bin/env bash
set -euo pipefail
umask 077
revision=${1:?40-character commit required}
digest=${2:?archive SHA256 required}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
[[ "$digest" =~ ^[a-f0-9]{64}$ ]]
node=/opt/class-assistant-runtime/node-v24.22.2-linux-x64/bin/node
archive=/root/class-assistant-$revision.tar.gz
release=/opt/homework/releases/$revision
database=/var/lib/homework/homework.sqlite
old=$(readlink -f /opt/homework/current)
[[ "$old" == /opt/homework/releases/* ]]
test -d "$old"
test ! -e "$release"
printf '%s  %s\n' "$digest" "$archive" | sha256sum -c -
install -d -m 755 "$release"
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$release"
chmod -R a+rX "$release"
cd "$release"
"$node" --input-type=module -e 'import assert from "node:assert/strict";import{readFileSync}from"node:fs";assert.equal(JSON.parse(readFileSync("RELEASE.json")).revision,process.argv[1])' "$revision"
"$node" --env-file=/etc/homework/homework.env --input-type=module -e 'import assert from "node:assert/strict";assert.equal(process.env.DATABASE_PATH,"/var/lib/homework/homework.sqlite")'
runuser -u homework -- "$node" scripts/check-release.mjs

# Test the migration on a server-only copy first. No local database is accepted.
runuser -u homework -- "$node" --env-file=/etc/homework/homework.env scripts/backup-database.mjs /var/lib/homework/backups
latest_backup() { find /var/lib/homework/backups -maxdepth 1 -name 'homework-*.sqlite' -printf '%T@ %p\n' | sort -rn | head -n1 | cut -d' ' -f2-; }
preflight=/var/lib/homework/preflight-$revision.sqlite
install -m 600 -o homework -g homework "$(latest_backup)" "$preflight"
runuser -u homework -- env DATABASE_PATH="$preflight" "$node" scripts/reconcile-courses.mjs
runuser -u homework -- env DATABASE_PATH="$preflight" "$node" scripts/reconcile-courses.mjs --apply
runuser -u homework -- env DATABASE_PATH="$preflight" "$node" scripts/reconcile-courses.mjs --check-clean

backup=''
migration_started=0
rollback() {
  status=$?
  trap - ERR
  set +e
  echo 'Deployment check failed; restoring previous release and server database backup.' >&2
  systemctl stop homework.service
  if [ "$migration_started" = 1 ]; then
    recovery=/var/lib/homework/backups/failed-$revision-$(date -u +%Y%m%dT%H%M%S)
    install -d -m 700 "$recovery"
    for suffix in '' '-wal' '-shm'; do
      if [ -f "$database$suffix" ]; then mv "$database$suffix" "$recovery/"; fi
    done
    install -m 600 -o homework -g homework "$backup" "$database"
  fi
  ln -s "$old" /opt/homework/.rollback-$revision
  mv -Tf /opt/homework/.rollback-$revision /opt/homework/current
  systemctl start homework.service
  exit "$status"
}
trap rollback ERR
systemctl stop homework.service
runuser -u homework -- "$node" --env-file=/etc/homework/homework.env scripts/backup-database.mjs /var/lib/homework/backups
backup=$(latest_backup)
test -s "$backup"
migration_started=1
runuser -u homework -- "$node" --env-file=/etc/homework/homework.env scripts/reconcile-courses.mjs --apply | tee "$release/DEPLOYMENT.txt"
ln -s "$release" /opt/homework/.next-$revision
mv -Tf /opt/homework/.next-$revision /opt/homework/current
systemctl start homework.service
"$node" --env-file=/etc/homework/homework.env scripts/verify-production.mjs "$revision" | tee -a "$release/DEPLOYMENT.txt"
systemctl is-active homework.service homework-web.service
printf 'Revision: %s\nPrevious: %s\nServer backup: %s\nPublished: %s\n' "$revision" "$old" "$backup" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$release/DEPLOYMENT.txt"
trap - ERR
echo "DEPLOYED: $revision"
