import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRouter from './routes/auth';
import gameRouter from './routes/game';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5177' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'thrash-margin-api', ts: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/game', gameRouter);

app.listen(PORT, () => {
  console.log(`Thrash Margin API on port ${PORT}`);
});

export default app;
