import cron from 'node-cron';
import prisma from '../lib/prisma';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { formatISO, format } from 'date-fns';

// Define interfaces for type safety
interface TaskWithDetails {
  id: string;
  title: string;
  dueDate: Date | null;
  status: string;
  updatedAt: Date;
  workflow: {
    name: string;
    project: {
      name: string;
      organization: {
        name: string;
      };
    };
  };
  assignee: {
    name: string;
    email: string;
  } | null;
}

interface TaskWithWorkflow {
  id: string;
  title: string;
  workflow: {
    project: {
      name: string;
    };
    name: string;
  };
  assignee: {
    name: string;
  } | null;
}

interface TimeLogWithDetails {
  hours: number;
  user: {
    name: string;
  } | null;
  task: {
    title: string;
  };
}

/**
 * Mark overdue tasks
 * Updates tasks that are past their due date to REVIEW status (as OVERDUE is not a valid status)
 */
export async function markOverdueTasks(): Promise<{
  processed: number;
  skipped: number;
  details: string;
}> {
  try {
    const now = new Date();
    
    // Only update tasks that:
    // 1. Have a due date that is in the past
    // 2. Are not already completed or in review
    const updateResult = await prisma.task.updateMany({
      where: {
        dueDate: { lt: now },
        status: { notIn: ['DONE', 'COMPLETED', 'REVIEW'] }
      },
      data: { 
        status: 'REVIEW', // Using REVIEW as our indicator for overdue tasks
        priority: 'URGENT' // Additionally set priority to URGENT for overdue tasks
      }
    });
    
    // Get list of updated tasks for detailed logging
    const updatedTasks = await prisma.task.findMany({
      where: {
        dueDate: { lt: now },
        status: 'REVIEW',
        updatedAt: { gt: new Date(now.getTime() - 60000) } // Updated in last minute
      },
      include: {
        workflow: {
          select: {
            name: true,
            project: {
              select: {
                name: true,
                organization: {
                  select: {
                    name: true
                  }
                }
              }
            }
          }
        },
        assignee: {
          select: {
            name: true,
            email: true
          }
        }
      }
    });
    
    const details = updatedTasks.map((task: TaskWithDetails) => ({
      taskId: task.id,
      title: task.title,
      dueDate: task.dueDate,
      project: task.workflow.project.name,
      organization: task.workflow.project.organization.name,
      assignee: task.assignee ? task.assignee.name : 'Unassigned'
    }));
    
    return {
      processed: updateResult.count,
      skipped: 0,
      details: JSON.stringify(details, null, 2)
    };
  } catch (error) {
    console.error('Error marking overdue tasks:', error);
    return {
      processed: 0,
      skipped: 0,
      details: `Error: ${error}`
    };
  }
}

/**
 * Generate daily digest
 * Creates a summary of important information from the last 24 hours
 */
export async function generateDailyDigest(): Promise<{
  success: boolean;
  filePath?: string;
  error?: string;
}> {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get all organizations
    const organizations = await prisma.organization.findMany();
    
    // Check if logs directory exists, create if not
    const logsDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Create a digest file for today
    const digestFileName = `daily-digest-${format(now, 'yyyy-MM-dd')}.log`;
    const digestFilePath = path.join(logsDir, digestFileName);
    
    // Initialize the digest content
    let digestContent = `=== DAILY DIGEST: ${format(now, 'yyyy-MM-dd')} ===\n\n`;
    
    // Process each organization
    for (const org of organizations) {
      digestContent += `\n--- ORGANIZATION: ${org.name} ---\n\n`;
      
      // Get new tasks created in last 24 hours
      const newTasks = await prisma.task.findMany({
        where: {
          createdAt: { gte: yesterday },
          workflow: {
            project: {
              organizationId: org.id
            }
          }
        },
        include: {
          workflow: {
            select: {
              name: true,
              project: {
                select: {
                  name: true
                }
              }
            }
          },
          assignee: {
            select: {
              name: true
            }
          }
        }
      });
      
      // Get tasks completed in last 24 hours
      const completedTasks = await prisma.task.findMany({
        where: {
          updatedAt: { gte: yesterday },
          status: { in: ['DONE', 'COMPLETED'] },
          workflow: {
            project: {
              organizationId: org.id
            }
          }
        },
        include: {
          workflow: {
            select: {
              name: true,
              project: {
                select: {
                  name: true
                }
              }
            }
          },
          assignee: {
            select: {
              name: true
            }
          }
        }
      });
      
      // Get overdue tasks - we use REVIEW status and URGENT priority as our overdue indicator
      const overdueTasks = await prisma.task.findMany({
        where: {
          status: 'REVIEW',
          priority: 'URGENT',
          dueDate: { lt: now },
          workflow: {
            project: {
              organizationId: org.id
            }
          }
        },
        include: {
          workflow: {
            select: {
              name: true,
              project: {
                select: {
                  name: true
                }
              }
            }
          },
          assignee: {
            select: {
              name: true
            }
          }
        }
      });
      
      // Get time logs from last 24 hours
      const timeLogs = await prisma.timeLog.findMany({
        where: {
          createdAt: { gte: yesterday },
          task: {
            workflow: {
              project: {
                organizationId: org.id
              }
            }
          }
        },
        include: {
          user: {
            select: {
              name: true
            }
          },
          task: {
            select: {
              title: true
            }
          }
        }
      });
      
      // Calculate total hours logged
      const totalHoursLogged = timeLogs.reduce((total: number, log: TimeLogWithDetails) => total + log.hours, 0);
      
      // Add summary stats
      digestContent += `Summary Stats:\n`;
      digestContent += `- New Tasks: ${newTasks.length}\n`;
      digestContent += `- Completed Tasks: ${completedTasks.length}\n`;
      digestContent += `- Overdue Tasks: ${overdueTasks.length}\n`;
      digestContent += `- Hours Logged: ${totalHoursLogged.toFixed(1)}\n\n`;
      
      // List new tasks
      if (newTasks.length > 0) {
        digestContent += `New Tasks:\n`;
        newTasks.forEach((task: TaskWithWorkflow) => {
          digestContent += `- [${task.workflow.project.name}] ${task.title} - Assigned to: ${task.assignee ? task.assignee.name : 'Unassigned'}\n`;
        });
        digestContent += '\n';
      }
      
      // List completed tasks
      if (completedTasks.length > 0) {
        digestContent += `Completed Tasks:\n`;
        completedTasks.forEach((task: TaskWithWorkflow) => {
          digestContent += `- [${task.workflow.project.name}] ${task.title} - Completed by: ${task.assignee ? task.assignee.name : 'Unknown'}\n`;
        });
        digestContent += '\n';
      }
      
      // List top 5 overdue tasks
      if (overdueTasks.length > 0) {
        digestContent += `Top ${Math.min(5, overdueTasks.length)} Overdue Tasks:\n`;
        overdueTasks.slice(0, 5).forEach((task: TaskWithWorkflow & { dueDate?: Date | null }) => {
          const daysOverdue = Math.floor((now.getTime() - (task.dueDate?.getTime() || 0)) / (24 * 60 * 60 * 1000));
          digestContent += `- [${task.workflow.project.name}] ${task.title} - ${daysOverdue} day(s) overdue - Assigned to: ${task.assignee ? task.assignee.name : 'Unassigned'}\n`;
        });
        digestContent += '\n';
      }
    }
    
    // Write digest to file
    fs.writeFileSync(digestFilePath, digestContent);
    
    console.log(`Daily digest generated at: ${digestFilePath}`);
    
    return {
      success: true,
      filePath: digestFilePath
    };
  } catch (error) {
    console.error('Error generating daily digest:', error);
    return {
      success: false,
      error: `${error}`
    };
  }
}

/**
 * Recalculate KPIs
 * Refreshes all KPI cache data to ensure metrics are current
 */
export async function recalculateKPIs(apiBaseUrl: string, authToken: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    // Get organizations
    const organizations = await prisma.organization.findMany();
    let successCount = 0;
    let errorCount = 0;
    
    // Refresh KPIs for each organization
    for (const org of organizations) {
      try {
        // First switch to the organization context
        const switchResponse = await axios.post(
          `${apiBaseUrl}/auth/switch-organization`,
          { organizationId: org.id },
          {
            headers: { Authorization: `Bearer ${authToken}` }
          }
        );
        
        // Get the new token with org context
        const orgToken = switchResponse.data.token;
        
        // Call the KPI refresh endpoint with the organization context
        const refreshResponse = await axios.post(
          `${apiBaseUrl}/kpi/refresh`, 
          {}, 
          {
            headers: { Authorization: `Bearer ${orgToken}` }
          }
        );
        
        if (refreshResponse.status === 200) {
          successCount++;
          console.log(`Successfully refreshed KPIs for organization: ${org.name}`);
        }
      } catch (error) {
        errorCount++;
        console.error(`Failed to refresh KPIs for organization ${org.name}:`, error);
      }
    }
    
    return {
      success: errorCount === 0,
      message: `KPI cache refreshed for ${successCount} organizations. ${errorCount > 0 ? `Failed for ${errorCount} organizations.` : ''}`
    };
  } catch (error) {
    console.error('Error recalculating KPIs:', error);
    return {
      success: false,
      message: `Failed to recalculate KPIs: ${error}`
    };
  }
}

/**
 * Schedule all daily automation tasks
 * @param apiBaseUrl - Base URL for the API
 * @param authToken - Auth token for API access
 */
export function scheduleDailyAutomation(apiBaseUrl: string, authToken: string) {
  // Schedule the job to run at midnight (00:00) every day
  cron.schedule('0 0 * * *', async () => {
    console.log('=== Running daily automation tasks ===');
    console.log('Date:', new Date().toISOString());
    
    try {
      // Step 1: Mark overdue tasks
      console.log('Step 1: Marking overdue tasks...');
      const overdueResult = await markOverdueTasks();
      console.log(`Marked ${overdueResult.processed} tasks as overdue`);
      
      // Step 2: Generate daily digest
      console.log('Step 2: Generating daily digest...');
      const digestResult = await generateDailyDigest();
      
      if (digestResult.success) {
        console.log(`Daily digest generated: ${digestResult.filePath}`);
      } else {
        console.error(`Failed to generate daily digest: ${digestResult.error}`);
      }
      
      // Step 3: Recalculate KPIs
      console.log('Step 3: Recalculating KPIs...');
      const kpiResult = await recalculateKPIs(apiBaseUrl, authToken);
      console.log(kpiResult.message);
      
      console.log('=== Daily automation completed successfully ===');
    } catch (error) {
      console.error('Error in daily automation job:', error);
    }
  });
  
  console.log('Daily automation job scheduled for midnight (00:00)');
}

export default {
  markOverdueTasks,
  generateDailyDigest,
  recalculateKPIs,
  scheduleDailyAutomation
};