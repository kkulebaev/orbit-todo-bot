import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { bot } from './bot-instance.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_URL = process.env.PUBLIC_URL;

if (!PUBLIC_URL) {
  throw new Error('Missing PUBLIC_URL (e.g. https://orbit-todo-bot.onrender.com)');
}

const app = express();

// Telegram sends JSON updates
app.use(express.json());

// Webhook endpoint
app.post('/telegram/webhook', async (req: Request, res: Response) => {
  try {
    // Pass update to grammY
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook handler error', e);
    res.sendStatus(500);
  }
});

app.get('/healthz', (_req: Request, res: Response) => res.status(200).send('ok'));

app.listen(PORT, async () => {
  console.log(`Orbit bot webhook server listening on :${PORT}`);

  // Register webhook on startup
  const hookUrl = `${PUBLIC_URL.replace(/\/$/, '')}/telegram/webhook`;
  try {
    await bot.api.setWebhook(hookUrl);
    console.log('Webhook set to', hookUrl);
  } catch (e) {
    console.error('Failed to set webhook', e);
  }
});
