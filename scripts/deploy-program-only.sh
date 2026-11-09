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
# Exact allowlist: this release cannot contain a database, secret or local data.
while IFS= read -r entry; do
  entry=${entry#./}
  case "$entry" in
    ''|dist|dist/*|server|server/*|shared|shared/*|scripts|scripts/*|需求文档|需求文档/*|package.json|package-lock.json|RELEASE.json|RELEASE-NOTES.md) ;;
    *) echo "Unexpected archive entry: $entry" >&2; exit 1 ;;
  esac
  case "/$entry/" in *'/../'*|*'/data/'*|*'/node_modules/'*|*'.sqlite'*|*'.db/'*|*'/.env'*|*'.pem/'*|*'.key/'*) exit 1 ;; esac
done < <(tar -tzf "$archive")
install -d -m 755 "$release"
tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$release"
chmod -R a+rX "$release"
cd "$release"
"$node" --input-type=module -e 'import assert from "node:assert/strict";import{readFileSync}from"node:fs";assert.equal(JSON.parse(readFileSync("RELEASE.json")).revision,process.argv[1])' "$revision"
"$node" --env-file=/etc/homework/homework.env --input-type=module -e 'import assert from "node:assert/strict";assert.equal(process.env.DATABASE_PATH,"/var/lib/homework/homework.sqlite")'
runuser -u homework -- "$node" scripts/check-release.mjs
latest_backup() { find /var/lib/homework/backups -maxdepth 1 -name 'homework-*.sqlite' -printf '%T@ %p\n' | sort -rn | head -n1 | cut -d' ' -f2-; }
upgrade() { runuser -u homework -- env DATABASE_PATH="$1" "$node" --input-type=module -e 'import{createApp}from"./server/app.mjs";const{server}=await createApp();server.emit("close");'; }
fingerprint() { runuser -u homework -- env DATABASE_PATH="$1" "$node" scripts/content-fingerprint.mjs "$2" "$3"; }

# Compatibility check on a server-only copy; no course reconciliation or import.
runuser -u homework -- "$node" --env-file=/etc/homework/homework.env scripts/backup-database.mjs /var/lib/homework/backups
preflight=/var/lib/homework/preflight-$revision.sqlite
manifest=/var/lib/homework/preflight-$revision.json
install -m 600 -o homework -g homework "$(latest_backup)" "$preflight"
fingerprint "$preflight" snapshot "$manifest"
upgrade "$preflight"
fingerprint "$preflight" verify "$manifest"

backup=''
upgrade_started=0
rollback() {
  status=$?
  trap - ERR
  set +e
  echo 'Deployment failed; restoring previous release and server-side backup.' >&2
  systemctl stop homework.service
  if [ "$upgrade_started" = 1 ]; then
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
manifest=/var/lib/homework/content-before-$revision.json
fingerprint "$database" snapshot "$manifest"
upgrade_started=1
upgrade "$database"
# All maintained rows and attachment bytes must remain exactly equal.
fingerprint "$database" verify "$manifest" | tee "$release/DEPLOYMENT.txt"
ln -s "$release" /opt/homework/.next-$revision
mv -Tf /opt/homework/.next-$revision /opt/homework/current
systemctl start homework.service
"$node" --env-file=/etc/homework/homework.env scripts/verify-production.mjs "$revision" --program-only | tee -a "$release/DEPLOYMENT.txt"
systemctl is-active homework.service homework-web.service
printf 'Revision: %s\nPrevious: %s\nServer backup: %s\nPublished: %s\nMode: program-only; no course reconciliation; original content verified.\n' "$revision" "$old" "$backup" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$release/DEPLOYMENT.txt"
cat RELEASE-NOTES.md >> "$release/DEPLOYMENT.txt"
trap - ERR
echo "DEPLOYED: $revision"
