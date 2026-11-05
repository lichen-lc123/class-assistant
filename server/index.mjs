import { createApp } from './app.mjs';
const port = Number(process.env.API_PORT || 3001);
const allowedOrigins = process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
const { server } = await createApp({ serveStatic: process.argv.includes('--static'), allowedOrigins, trustLoopbackProxy: process.env.TRUST_LOOPBACK_PROXY === '1' });
server.listen(port, '127.0.0.1', () => console.log(`账号服务已启动：http://127.0.0.1:${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  const timeout = setTimeout(() => process.exit(1), 25000);
  timeout.unref();
  server.close(() => { clearTimeout(timeout); process.exit(0); });
});
