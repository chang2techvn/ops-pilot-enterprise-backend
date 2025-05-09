import 'dotenv/config';
import express from 'express';
import { authMiddleware } from './auth/middleware';
import authRoutes from './auth/routes';

// Create Express application
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

// Import APIs that exist
app.use('/auth', authRoutes);

// Route for the API root
app.get('/', (req, res) => {
  res.json({ message: 'OPS Pilot Enterprise API' });
});

// Start the server if running directly
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

export default app;
