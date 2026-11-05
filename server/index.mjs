import { createApp } from './app.mjs';
const port = Number(process.env.API_PORT || 3001);
const allowedOrigins = process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
const { server } = await createApp({ serveStatic: process.argv.includes('--static'), allowedOrigins });
server.listen(port, '127.0.0.1', () => console.log(`账号服务已启动：http://127.0.0.1:${port}`));
