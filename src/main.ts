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
import { initBackgroundJobs } from './jobs/init';

// Create Express application
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

// Import APIs that exist
app.use('/auth', authRoutes);
app.use('/workflows', workflowRoutes);
app.use('/tasks', taskRoutes);
app.use('/projects', projectRoutes);
app.use('/timelogs', timelogRoutes);
app.use('/etl', etlRoutes);
app.use('/kpi', kpiRoutes);

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
