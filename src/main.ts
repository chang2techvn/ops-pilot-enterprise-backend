import 'dotenv/config';
import express from 'express';
import { authMiddleware } from './auth/middleware';
import authRoutes from './auth/routes';
import workflowRoutes from './workflows/routes';
import taskRoutes from './tasks/routes';
import projectRoutes from './projects/routes';
import timelogRoutes from './timelogs/routes';
import etlRoutes from './etl/routes';
import kpiRoutes from './kpi/routes'; 
import exportRoutes from './exports/routes';
import { initBackgroundJobs } from './jobs/init';

// Create Express application
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

// Define API router with /api prefix
const apiRouter = express.Router();

// Import APIs that exist
apiRouter.use('/auth', authRoutes);
apiRouter.use('/workflows', workflowRoutes);
apiRouter.use('/tasks', taskRoutes);
apiRouter.use('/projects', projectRoutes);
apiRouter.use('/timelogs', timelogRoutes);
apiRouter.use('/etl', etlRoutes);
apiRouter.use('/kpi', kpiRoutes);
apiRouter.use('/exports', exportRoutes);

// Mount all API routes under /api prefix
app.use('/api', apiRouter);

// Route for the API root
app.get('/', (req, res) => {
  res.json({ message: 'OPS Pilot Enterprise API' });
});

// Start the server if running directly
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    
    // Get API base URL from environment or default to localhost
    const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${port}`;
    
    // Initialize background jobs with a system admin token
    // This is a placeholder - in production, use a secure method to obtain an admin token
    const adminToken = process.env.ADMIN_TOKEN || 'system-admin-token';
    
    // Initialize background jobs after server starts
    initBackgroundJobs(apiBaseUrl, adminToken);
  });
}

export default app;
