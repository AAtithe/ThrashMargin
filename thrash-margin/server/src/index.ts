// server/src/index.ts
// Entry point — Claude Code: flesh out routes, add middleware, connect DB

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'thrash-margin-api', ts: new Date().toISOString() });
});

// TODO — Claude Code: mount route handlers
// app.use('/api/auth', authRouter);
// app.use('/api/game', gameRouter);

app.listen(PORT, () => {
  console.log(`Thrash Margin API running on port ${PORT}`);
});

export default app;
