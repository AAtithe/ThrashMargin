import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth';
import gameRouter from './routes/game';

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'thrash-margin-api' });
});

app.use('/api/auth', authRouter);
app.use('/api/game', gameRouter);

export default app;
