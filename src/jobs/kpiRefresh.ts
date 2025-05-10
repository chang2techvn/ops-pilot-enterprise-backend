import cron from 'node-cron';
import axios from 'axios';

/**
 * Schedule a daily job to refresh the KPI cache
 * @param apiBaseUrl - Base URL of the API
 * @param authToken - Admin authentication token
 */
export const scheduleKpiCacheRefresh = (apiBaseUrl: string, authToken: string): void => {
  // Schedule to run at 2:00 AM every day (server time)
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('Running scheduled KPI cache refresh...');
      
      // Call the KPI refresh endpoint
      await axios.post(`${apiBaseUrl}/kpi/refresh`, {}, {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });
      
      console.log('KPI cache refresh completed successfully');
    } catch (error) {
      console.error('Error refreshing KPI cache in scheduled job:', error);
    }
  });
  
  console.log('KPI cache refresh job scheduled for 2:00 AM daily');
};

export default {
  scheduleKpiCacheRefresh
};