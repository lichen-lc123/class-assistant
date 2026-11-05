import { isIP } from 'node:net';

// Only enable behind a loopback proxy that replaces this header.
export function clientAddress(req, trustLoopbackProxy = false) {
  const peer = req.socket.remoteAddress || 'unknown';
  if (!trustLoopbackProxy || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return peer;
  const header = req.headers['x-forwarded-for'];
  if (typeof header !== 'string') return peer;
  const address = header.trim();
  return isIP(address) ? address : peer;
}
