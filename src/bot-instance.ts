import 'dotenv/config';
import { Bot } from 'grammy';

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN in env');

export const bot = new Bot(BOT_TOKEN);
