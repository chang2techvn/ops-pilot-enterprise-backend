import express, { Request, Response } from 'express';
import { requireRole } from '../auth/middleware';
import prisma from '../lib/prisma';
import NodeCache from 'node-cache';

// Define types for better type safety
interface ProjectTask {
  id: string;
  status: string;
  updatedAt: Date;
  [key: string]: any;
}

interface Workflow {
  tasks: ProjectTask[];
  [key: string]: any;
}

interface Project {
  id: string;
  name: string;
  createdAt: Date;
  workflows: Workflow[];
  [key: string]: any;
}

interface TaskEntry {
  assigneeId: string;
  _count: {
    id: number;
  };
}

interface TimeLogEntry {
  hours: number;
  [key: string]: any;
}

interface EmployeePerformance {
  assignee: any;
  totalCompletedTasks: number;
  totalTimeSpent: number;
  averageCompletionTime: number;
  tasks: any[];
  [key: string]: any;
}

interface TeamPerformanceEntry {
  completionRate: number;
  [key: string]: any;
}

const router = express.Router();
// Create a cache with a default TTL of 24 hours (86400 seconds)
const kpiCache = new NodeCache({ stdTTL: 86400 });

// Organization-level KPI dashboard
router.get('/org', requireRole(['ADMIN', 'OWNER', 'PROJECT_MANAGER'], true), async (req: Request, res: Response) => {
  try {
    const organizationId = req.context!.user!.organizationId!;
    const cacheKey = `orgKPI-${organizationId}`;
    
    // Try to get data from cache first
    let dashboardData = kpiCache.get(cacheKey);
    
    if (!dashboardData) {
      // Get all projects in the organization
      const projects = await prisma.project.findMany({
        where: { organizationId, status: 'ACTIVE' },
        include: {
          workflows: {
            include: {
              tasks: true
            }
          }
        }
      });
      
      // Calculate task completion percentage
      let totalTasks = 0;
      let completedTasks = 0;
      let inProgressTasks = 0;
      const projectCompletionRates: any[] = [];
      const projectDurations: any[] = [];
      
      // Calculate average project duration in days
      for (const project of projects) {
        // Get all tasks for this project
        const tasks = project.workflows.flatMap((wf: Workflow) => wf.tasks);
        const projectTasksCount = tasks.length;
        
        if (projectTasksCount > 0) {
          const projectCompletedTasks = tasks.filter((t: ProjectTask) => 
            t.status === 'DONE' || t.status === 'COMPLETED').length;
          
          const completionRate = projectTasksCount > 0 
            ? (projectCompletedTasks / projectTasksCount) * 100
            : 0;
            
          projectCompletionRates.push({
            projectId: project.id,
            projectName: project.name,
            completionRate: parseFloat(completionRate.toFixed(2))
          });
          
          totalTasks += projectTasksCount;
          completedTasks += projectCompletedTasks;
          inProgressTasks += tasks.filter((t: ProjectTask) => t.status === 'IN_PROGRESS').length;
          
          // Calculate project duration (days between creation and last task update)
          const taskDates = tasks.map((t: ProjectTask) => t.updatedAt.getTime());
          
          if (taskDates.length > 0) {
            const latestTaskUpdate = new Date(Math.max(...taskDates));
            const projectStart = project.createdAt;
            const durationDays = Math.ceil(
              (latestTaskUpdate.getTime() - projectStart.getTime()) / (1000 * 60 * 60 * 24)
            );
            
            projectDurations.push({
              projectId: project.id,
              projectName: project.name,
              durationDays,
              startDate: projectStart,
              lastUpdate: latestTaskUpdate
            });
          }
        }
      }
      
      // Calculate org-level completion rate
      const overallCompletionRate = totalTasks > 0 
        ? (completedTasks / totalTasks) * 100
        : 0;
      
      // Get top-performing teams (by workflow completion rate)
      const workflowCompletionRates = await prisma.workflow.findMany({
        where: {
          project: {
            organizationId
          }
        },
        select: {
          id: true,
          name: true,
          project: {
            select: {
              id: true,
              name: true
            }
          },
          tasks: {
            select: {
              status: true
            }
          },
          ownerId: true,
          owner: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      });
      
      const teamPerformance = workflowCompletionRates.map((wf: any) => {
        const totalWfTasks = wf.tasks.length;
        const completedWfTasks = wf.tasks.filter((t: any) => 
          t.status === 'DONE' || t.status === 'COMPLETED').length;
          
        const completionRate = totalWfTasks > 0 
          ? (completedWfTasks / totalWfTasks) * 100
          : 0;
          
        return {
          workflowId: wf.id,
          workflowName: wf.name,
          projectId: wf.project.id,
          projectName: wf.project.name,
          teamLead: wf.owner,
          taskCount: totalWfTasks,
          completedTasks: completedWfTasks,
          completionRate: parseFloat(completionRate.toFixed(2))
        };
      }).sort((a: TeamPerformanceEntry, b: TeamPerformanceEntry) => b.completionRate - a.completionRate);
      
      // Average project duration
      const avgProjectDuration = projectDurations.length > 0
        ? projectDurations.reduce((sum: number, p: any) => sum + p.durationDays, 0) / projectDurations.length
        : 0;
      
      // Overall KPI data
      dashboardData = {
        summary: {
          totalProjects: projects.length,
          totalTasks,
          completedTasks,
          inProgressTasks,
          overallCompletionRate: parseFloat(overallCompletionRate.toFixed(2)),
          avgProjectDuration: parseFloat(avgProjectDuration.toFixed(2))
        },
        projects: {
          projectCompletionRates,
          projectDurations
        },
        teams: teamPerformance,
        lastUpdated: new Date()
      };
      
      // Store in cache
      kpiCache.set(cacheKey, dashboardData);
    }
    
    res.json(dashboardData);
  } catch (error) {
    console.error('Error generating organization KPI report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Team-level KPI dashboard (reporting on employees/assignees)
router.get('/team/:workflowId?', requireRole(['ADMIN', 'OWNER', 'PROJECT_MANAGER'], true), async (req: Request, res: Response) => {
  try {
    const organizationId = req.context!.user!.organizationId!;
    const { workflowId } = req.params;
    
    const cacheKey = workflowId 
      ? `teamKPI-${workflowId}`
      : `orgTeamKPI-${organizationId}`;
      
    // Try to get data from cache first
    let teamData = kpiCache.get(cacheKey);
    
    if (!teamData) {
      // Build the query based on whether a specific workflow was requested
      const where: any = {
        workflow: {
          project: {
            organizationId
          }
        },
        assigneeId: { not: null } // Only include tasks that are assigned
      };
      
      if (workflowId) {
        where.workflowId = workflowId;
      }
      
      // Get all completed tasks with their time logs
      const completedTasks = await prisma.task.findMany({
        where: {
          ...where,
          status: { in: ['DONE', 'COMPLETED'] }
        },
        select: {
          id: true,
          title: true,
          assigneeId: true,
          assignee: {
            select: {
              id: true,
              name: true,
              email: true
            }
          },
          createdAt: true,
          updatedAt: true,
          timeLogs: true,
          externalLogs: true,
          workflow: {
            select: {
              id: true,
              name: true,
              project: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        }
      });
      
      // Get all tasks per assignee (for completion rate calculation)
      const allTasks = await prisma.task.groupBy({
        by: ['assigneeId'],
        where,
        _count: { id: true }
      });
      
      // Get completed tasks per assignee
      const completedTasksGroup = await prisma.task.groupBy({
        by: ['assigneeId'],
        where: {
          ...where,
          status: { in: ['DONE', 'COMPLETED'] }
        },
        _count: { id: true }
      });
      
      // Calculate task completion time (time between creation and completion)
      const employeePerformance: Record<string, EmployeePerformance> = {};
      
      completedTasks.forEach((task: any) => {
        const assigneeId = task.assigneeId as string;
        
        if (!employeePerformance[assigneeId]) {
          employeePerformance[assigneeId] = {
            assignee: task.assignee,
            totalCompletedTasks: 0,
            totalTimeSpent: 0,
            averageCompletionTime: 0,
            tasks: []
          };
        }
        
        // Calculate time spent based on time logs
        const timeLogHours = task.timeLogs.reduce((total: number, log: TimeLogEntry) => total + (log.hours || 0), 0);
        const externalLogHours = task.externalLogs.reduce((total: number, log: TimeLogEntry) => total + (log.hours || 0), 0);
        const totalHoursSpent = timeLogHours + externalLogHours;
        
        // Calculate completion time in days
        const completionTimeDays = Math.ceil(
          (task.updatedAt.getTime() - task.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        employeePerformance[assigneeId].totalCompletedTasks += 1;
        employeePerformance[assigneeId].totalTimeSpent += totalHoursSpent;
        
        employeePerformance[assigneeId].tasks.push({
          taskId: task.id,
          title: task.title,
          workflowId: task.workflow.id,
          workflowName: task.workflow.name,
          projectId: task.workflow.project.id,
          projectName: task.workflow.project.name,
          completionTimeDays,
          timeSpentHours: totalHoursSpent
        });
      });
      
      // Calculate average completion time and efficiency metrics
      Object.keys(employeePerformance).forEach(assigneeId => {
        const employee = employeePerformance[assigneeId];
        
        // Find total tasks for this assignee
        const totalTasksEntry = allTasks.find((entry: TaskEntry) => entry.assigneeId === assigneeId);
        const totalTasks = totalTasksEntry ? totalTasksEntry._count.id : 0;
        
        // Find completed tasks for this assignee
        const completedTasksEntry = completedTasksGroup.find((entry: TaskEntry) => entry.assigneeId === assigneeId);
        const completedTasks = completedTasksEntry ? completedTasksEntry._count.id : 0;
        
        // Calculate completion rate
        const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
        
        // Calculate average completion time in days
        const totalCompletionTimeDays = employee.tasks.reduce(
          (total: number, task: any) => total + task.completionTimeDays, 
          0
        );
        
        const averageCompletionTimeDays = 
          employee.totalCompletedTasks > 0 ? totalCompletionTimeDays / employee.totalCompletedTasks : 0;
        
        // Calculate efficiency (tasks completed per day of work)
        const averageTimePerTask = 
          employee.totalCompletedTasks > 0 ? employee.totalTimeSpent / employee.totalCompletedTasks : 0;
        
        // Update the employee record with calculated metrics
        employeePerformance[assigneeId] = {
          ...employee,
          totalTasks,
          completedTasks,
          completionRate: parseFloat(completionRate.toFixed(2)),
          averageCompletionTimeDays: parseFloat(averageCompletionTimeDays.toFixed(2)),
          averageTimePerTaskHours: parseFloat(averageTimePerTask.toFixed(2)),
          efficiency: parseFloat(
            (employee.totalCompletedTasks / (employee.totalTimeSpent || 1) * 10).toFixed(2)
          ) // Higher is better - tasks per 10 hours
        };
      });
      
      // Convert to array and sort by efficiency (highest first)
      const employeeArray = Object.values(employeePerformance)
        .sort((a: any, b: any) => b.efficiency - a.efficiency);
      
      teamData = {
        employees: employeeArray,
        topPerformers: employeeArray.slice(0, 5),
        stats: {
          totalEmployees: employeeArray.length,
          averageCompletionRate: parseFloat(
            (employeeArray.reduce((sum: number, emp: any) => sum + emp.completionRate, 0) / 
            (employeeArray.length || 1)).toFixed(2)
          ),
          averageEfficiency: parseFloat(
            (employeeArray.reduce((sum: number, emp: any) => sum + emp.efficiency, 0) / 
            (employeeArray.length || 1)).toFixed(2)
          )
        },
        scope: workflowId ? 'workflow' : 'organization',
        scopeId: workflowId || organizationId,
        lastUpdated: new Date()
      };
      
      // Store in cache
      kpiCache.set(cacheKey, teamData);
    }
    
    res.json(teamData);
  } catch (error) {
    console.error('Error generating team KPI report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Refresh KPI cache (can be called manually or via a scheduled job)
router.post('/refresh', requireRole(['ADMIN', 'PROJECT_MANAGER'], true), (_req: Request, res: Response) => {
  try {
    kpiCache.flushAll();
    res.json({ success: true, message: 'KPI cache refreshed' });
  } catch (error) {
    console.error('Error refreshing KPI cache:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get cache status
router.get('/cache-status', requireRole(['ADMIN', 'PROJECT_MANAGER'], true), (_req: Request, res: Response) => {
  try {
    const stats = kpiCache.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting cache stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;