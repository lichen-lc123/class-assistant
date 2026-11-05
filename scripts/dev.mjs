import { spawn } from 'node:child_process';
const api = spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit' });
const web = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { stdio: 'inherit' });
let closing = false;
function close(code = 0) { if (closing) return; closing = true; api.kill(); web.kill(); process.exitCode = code; }
api.on('exit', (code) => close(code || 0)); web.on('exit', (code) => close(code || 0));
for (const child of [api, web]) child.on('error', () => close(1));
process.on('SIGINT', () => close()); process.on('SIGTERM', () => close());
