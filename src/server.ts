import 'dotenv/config';
import express, { type Request, type Response } from 'express';

// Register all bot handlers (commands/callbacks)
import './bot.js';
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

// Render requires binding to 0.0.0.0 on the provided PORT
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Orbit bot webhook server listening on 0.0.0.0:${PORT}`);

  // Ensure grammY has botInfo loaded (required for webhook-only mode)
  try {
    await bot.init();
    console.log('Bot initialized');
  } catch (e) {
    console.error('Failed to init bot', e);
  }

  // Register webhook on startup
  const hookUrl = `${PUBLIC_URL.replace(/\/$/, '')}/telegram/webhook`;
  try {
    await bot.api.setWebhook(hookUrl);
    console.log('Webhook set to', hookUrl);
  } catch (e) {
    console.error('Failed to set webhook', e);
  }
});
