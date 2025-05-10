import { scheduleDailyAutomation } from './dailyAutomation';
import { scheduleKpiCacheRefresh } from './kpiRefresh';

/**
 * Initialize all background jobs
 * @param apiBaseUrl - Base URL of the API for callbacks
 * @param adminToken - Admin authentication token for secured API calls
 */
export function initBackgroundJobs(apiBaseUrl: string, adminToken: string): void {
  console.log('Initializing background jobs...');
  
  // Schedule daily automation tasks (runs at midnight)
  scheduleDailyAutomation(apiBaseUrl, adminToken);
  
  // Schedule separate KPI refresh jobs (runs at 2:00 AM)
  scheduleKpiCacheRefresh(apiBaseUrl, adminToken);
  
  console.log('All background jobs initialized successfully');
}

export default {
  initBackgroundJobs
};