import { scheduleKpiCacheRefresh } from '../../jobs/kpiRefresh';

/**
 * Initialize the KPI caching system
 * @param apiBaseUrl - Base URL of the API
 * @param authToken - Admin authentication token for scheduled refresh
 */
export function initKpiCache(apiBaseUrl: string, authToken: string) {
  // Schedule daily refresh job
  scheduleKpiCacheRefresh(apiBaseUrl, authToken);
  
  console.log('KPI cache system initialized');
  
  return {
    status: 'initialized',
    refreshSchedule: '0 2 * * *' // 2:00 AM daily
  };
}