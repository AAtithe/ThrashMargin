// server/src/routes/auth.ts
// Claude Code: implement register and login endpoints

import { Router, Request, Response } from 'express';
// import bcrypt from 'bcrypt';
// import jwt from 'jsonwebtoken';
// import { db } from '../db/client';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  // TODO: validate body, hash password, insert user, return JWT
  res.status(501).json({ message: 'Not implemented — Claude Code: build this out' });
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  // TODO: find user, compare password, return JWT
  res.status(501).json({ message: 'Not implemented — Claude Code: build this out' });
});

export default router;
