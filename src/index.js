import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import intakeRouter from './api/intake.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/intake', intakeRouter);

app.listen(PORT, () => {
  console.log(`Merridian Intake backend running on port ${PORT}`);
});
