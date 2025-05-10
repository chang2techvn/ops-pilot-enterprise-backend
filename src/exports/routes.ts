import express, { Request, Response } from 'express';
import { requireRole } from '../auth/middleware';
import prisma from '../lib/prisma';
import { Parser } from 'json2csv';
import { format as dateFormat } from 'date-fns';

const router = express.Router();

// Interface for query parameters
interface ExportQueryParams {
  format?: string; // Changed from union type to string to avoid callable errors
  startDate?: string;
  endDate?: string;
  userId?: string;
  projectId?: string;
  workflowId?: string;
  status?: string;
  taskId?: string;
}

// Task interface for type safety
interface TaskWithDetails {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date | null;
  workflow: {
    id: string;
    name: string;
    project: {
      id: string;
      name: string;
    };
  };
  assignee?: {
    id: string;
    name: string;
    email: string;
  } | null;
  timeLogs: Array<{
    id: string;
    hours: number;
    date: Date;
    notes?: string | null;
    startTime?: Date | null;
    endTime?: Date | null;
    userId: string;
    user?: {
      id: string;
      name: string;
    } | null;
  }>;
  externalLogs: Array<{
    id: string;
    hours: number;
    userId?: string | null;
    description?: string | null;
  }>;
}

// TimeLog interface for type safety
interface TimeLogWithDetails {
  id: string;
  date: Date;
  hours: number;
  notes?: string | null;
  startTime?: Date | null;
  endTime?: Date | null;
  taskId: string;
  createdAt: Date; // Added this missing property
  task: {
    id: string;
    title: string;
    status: string;
    externalCode?: string | null; // Added this missing property
    workflow: {
      id: string;
      name: string;
      project: {
        id: string;
        name: string;
      };
    };
  };
  user: {
    id: string;
    name: string;
    email: string;
  };
}

// ExternalLog interface for type safety
interface ExternalLogWithDetails {
  id: string;
  date: Date;
  hours: number;
  description?: string | null;
  sourceSystem: string;
  taskId: string;
  userId?: string | null;
  userName?: string | null;
  createdAt: Date; // Added missing property
  task: {
    id: string;
    title: string;
    status: string;
    externalCode?: string | null;
    workflow: {
      id: string;
      name: string;
      project: {
        id: string;
        name: string;
      };
    };
  };
  user?: {
    id: string;
    name: string;
    email: string;
  } | null;
}

// Project interface for type safety
interface ProjectWithWorkflows {
  id: string;
  name: string;
  createdAt: Date;
  status: string;
  workflows: Array<{
    id: string;
    name: string;
    tasks: Array<{
      id: string;
      status: string;
      updatedAt: Date;
      timeLogs: Array<{
        hours: number;
        userId: string;
      }>;
      externalLogs: Array<{
        hours: number;
        userId?: string | null;
      }>;
      assignee?: {
        id: string;
        name: string;
      } | null;
    }>;
  }>;
}

/**
 * Export tasks report - allows filtering by various parameters
 */
router.get('/tasks', requireRole(['ADMIN', 'PROJECT_MANAGER', 'OWNER'], true), async (req: Request, res: Response) => {
  try {
    const organizationId = req.context!.user!.organizationId;
    const { 
      format = 'csv', 
      startDate, 
      endDate, 
      userId, 
      projectId, 
      workflowId,
      status
    } = req.query as ExportQueryParams;
    
    const where: any = {
      workflow: {
        project: {
          organizationId
        }
      }
    };
    
    // Apply filters if provided
    if (startDate) {
      where.createdAt = { 
        ...(where.createdAt || {}),
        gte: new Date(startDate)
      };
    }
    
    if (endDate) {
      where.createdAt = {
        ...(where.createdAt || {}),
        lte: new Date(endDate)
      };
    }
    
    if (userId) {
      where.assigneeId = userId;
    }
    
    if (workflowId) {
      where.workflowId = workflowId;
    }
    
    if (status) {
      where.status = status;
    }
    
    if (projectId) {
      where.workflow = {
        ...(where.workflow || {}),
        projectId
      };
    }
    
    // Fetch tasks with related data
    const tasks = await prisma.task.findMany({
      where,
      include: {
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
        },
        assignee: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        timeLogs: {
          select: {
            id: true,
            hours: true,
            date: true,
            notes: true,
            userId: true,
            user: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        externalLogs: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Format data for export
    const formattedTasks = tasks.map((task: TaskWithDetails) => ({
      taskId: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      createdAt: dateFormat(task.createdAt, 'yyyy-MM-dd HH:mm:ss'),
      updatedAt: dateFormat(task.updatedAt, 'yyyy-MM-dd HH:mm:ss'),
      dueDate: task.dueDate ? dateFormat(task.dueDate, 'yyyy-MM-dd') : null,
      projectName: task.workflow.project.name,
      workflowName: task.workflow.name,
      assignee: task.assignee ? task.assignee.name : 'Unassigned',
      assigneeEmail: task.assignee ? task.assignee.email : null,
      totalHoursLogged: task.timeLogs.reduce((sum: number, log: { hours: number }) => sum + (log.hours || 0), 0)
    }));
    
    // Generate filename with date stamp
    const timestamp = dateFormat(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `tasks_export_${timestamp}`;
    
    // Return data in requested format
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.json`);
      return res.json({
        exportedAt: new Date().toISOString(),
        totalRecords: formattedTasks.length,
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
          userId: userId || null,
          projectId: projectId || null,
          workflowId: workflowId || null,
          status: status || null
        },
        data: formattedTasks
      });
    } else {
      // CSV format (default)
      const fields = [
        'taskId',
        'title',
        'description',
        'status',
        'priority',
        'createdAt',
        'updatedAt',
        'dueDate',
        'projectName',
        'workflowName',
        'assignee',
        'assigneeEmail',
        'totalHoursLogged'
      ];
      
      const parser = new Parser({ fields });
      const csv = parser.parse(formattedTasks);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
      return res.send(csv);
    }
  } catch (error) {
    console.error('Error exporting tasks:', error);
    return res.status(500).json({ error: 'Failed to export tasks' });
  }
});

/**
 * Export time logs report - allows filtering by various parameters
 */
router.get('/timelogs', requireRole(['ADMIN', 'PROJECT_MANAGER', 'OWNER'], true), async (req: Request, res: Response) => {
  try {
    const organizationId = req.context!.user!.organizationId;
    const { 
      format = 'csv', 
      startDate, 
      endDate, 
      userId, 
      projectId,
      taskId 
    } = req.query as ExportQueryParams;
    
    const where: any = {
      task: {
        workflow: {
          project: {
            organizationId
          }
        }
      }
    };
    
    // Apply filters if provided
    if (startDate) {
      where.date = { 
        ...(where.date || {}),
        gte: new Date(startDate)
      };
    }
    
    if (endDate) {
      where.date = {
        ...(where.date || {}),
        lte: new Date(endDate)
      };
    }
    
    if (userId) {
      where.userId = userId;
    }
    
    if (taskId) {
      where.taskId = taskId;
    }
    
    if (projectId) {
      where.task = {
        ...(where.task || {}),
        workflow: {
          ...(where.task?.workflow || {}),
          projectId
        }
      };
    }
    
    // Fetch time logs with related data
    const timeLogs = await prisma.timeLog.findMany({
      where,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            externalCode: true,
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
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });
    
    // Format data for export
    const formattedLogs = timeLogs.map((log: any) => ({
      logId: log.id,
      date: dateFormat(log.date, 'yyyy-MM-dd'),
      hours: log.hours,
      notes: log.notes,
      taskId: log.taskId,
      taskTitle: log.task.title,
      taskStatus: log.task.status,
      projectName: log.task.workflow.project.name,
      workflowName: log.task.workflow.name,
      userName: log.user.name,
      userEmail: log.user.email,
      startTime: log.startTime ? dateFormat(log.startTime, 'HH:mm:ss') : null,
      endTime: log.endTime ? dateFormat(log.endTime, 'HH:mm:ss') : null,
      createdAt: log.createdAt ? dateFormat(log.createdAt, 'yyyy-MM-dd HH:mm:ss') : null
    }));
    
    // Generate filename with date stamp
    const timestamp = dateFormat(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `timelogs_export_${timestamp}`;
    
    // Return data in requested format
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.json`);
      return res.json({
        exportedAt: new Date().toISOString(),
        totalRecords: formattedLogs.length,
        filters: {
          startDate: startDate || null,
          endDate: endDate || null,
          userId: userId || null,
          projectId: projectId || null,
          taskId: taskId || null
        },
        data: formattedLogs
      });
    } else {
      // CSV format (default)
      const fields = [
        'logId',
        'date',
        'hours',
        'notes',
        'taskId',
        'taskTitle',
        'taskStatus',
        'projectName',
        'workflowName',
        'userName',
        'userEmail',
        'startTime',
        'endTime',
        'createdAt'
      ];
      
      const parser = new Parser({ fields });
      const csv = parser.parse(formattedLogs);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
      return res.send(csv);
    }
  } catch (error) {
    console.error('Error exporting time logs:', error);
    return res.status(500).json({ error: 'Failed to export time logs' });
  }
});

/**
 * Export combined internal and external time logs for auditing
 */
router.get('/audit', requireRole(['ADMIN', 'OWNER'], true), async (req: Request, res: Response) => {
  try {
    const organizationId = req.context!.user!.organizationId;
    const { format = 'csv', startDate, endDate } = req.query as ExportQueryParams;
    
    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate);
    }
    
    // Fetch internal time logs
    const internalLogs = await prisma.timeLog.findMany({
      where: {
        ...(startDate || endDate ? { date: dateFilter } : {}),
        task: {
          workflow: {
            project: {
              organizationId
            }
          }
        }
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            externalCode: true,
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
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });
    
    // Fetch external time logs
    const externalLogs = await prisma.externalLog.findMany({
      where: {
        ...(startDate || endDate ? { date: dateFilter } : {}),
        task: {
          workflow: {
            project: {
              organizationId
            }
          }
        }
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            externalCode: true,
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
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });
    
    // Format internal logs
    const formattedInternalLogs = internalLogs.map((log: any) => ({
      logId: log.id,
      source: 'Internal',
      date: dateFormat(log.date, 'yyyy-MM-dd'),
      hours: log.hours,
      notes: log.notes,
      taskId: log.taskId,
      taskTitle: log.task.title,
      externalCode: log.task.externalCode || 'N/A',
      projectName: log.task.workflow.project.name,
      workflowName: log.task.workflow.name,
      userName: log.user.name,
      userEmail: log.user.email,
      createdAt: dateFormat(log.createdAt || new Date(), 'yyyy-MM-dd HH:mm:ss')
    }));
    
    // Format external logs
    const formattedExternalLogs = externalLogs.map((log: any) => ({
      logId: log.id,
      source: `External (${log.sourceSystem})`,
      date: dateFormat(log.date, 'yyyy-MM-dd'),
      hours: log.hours,
      notes: log.description,
      taskId: log.taskId,
      taskTitle: log.task.title,
      externalCode: log.task.externalCode || 'N/A',
      projectName: log.task.workflow.project.name,
      workflowName: log.task.workflow.name,
      userName: log.userName || (log.user ? log.user.name : 'External User'),
      userEmail: log.user ? log.user.email : 'N/A',
      createdAt: dateFormat(log.createdAt || new Date(), 'yyyy-MM-dd HH:mm:ss')
    }));
    
    // Combine and sort all logs
    const combinedLogs = [...formattedInternalLogs, ...formattedExternalLogs]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
    // Generate filename with date stamp
    const timestamp = dateFormat(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `audit_export_${timestamp}`;
    
    // Return data in requested format
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.json`);
      return res.json({
        exportedAt: new Date().toISOString(),
        totalRecords: combinedLogs.length,
        internalLogsCount: formattedInternalLogs.length,
        externalLogsCount: formattedExternalLogs.length,
        filters: {
          startDate: startDate || null,
          endDate: endDate || null
        },
        data: combinedLogs
      });
    } else {
      // CSV format (default)
      const fields = [
        'logId',
        'source',
        'date',
        'hours',
        'notes',
        'taskId',
        'taskTitle',
        'externalCode',
        'projectName',
        'workflowName',
        'userName',
        'userEmail',
        'createdAt'
      ];
      
      const parser = new Parser({ fields });
      const csv = parser.parse(combinedLogs);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
      return res.send(csv);
    }
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    return res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

/**
 * Export KPI report for organization
 */
router.get('/kpi', requireRole(['ADMIN', 'PROJECT_MANAGER', 'OWNER'], true), async (req: Request, res: Response) => {
  try {
    const organizationId = req.context!.user!.organizationId;
    const { format = 'csv' } = req.query as ExportQueryParams;
    
    // Get all projects in the organization
    const projects = await prisma.project.findMany({
      where: { organizationId, status: 'ACTIVE' },
      include: {
        workflows: {
          include: {
            tasks: {
              include: {
                timeLogs: true,
                externalLogs: true,
                assignee: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            }
          }
        }
      }
    });
    
    // Format data for export
    const kpiData: any[] = [];
    
    // Project level KPIs
    for (const project of projects) {
      // Get all tasks for this project
      const tasks = project.workflows.flatMap((wf: any) => wf.tasks);
      const totalTasks = tasks.length;
      
      if (totalTasks > 0) {
        const completedTasks = tasks.filter((t: { status: string }) => 
          t.status === 'DONE' || t.status === 'COMPLETED').length;
        const inProgressTasks = tasks.filter((t: { status: string }) => t.status === 'IN_PROGRESS').length;
        const pendingTasks = totalTasks - completedTasks - inProgressTasks;
        
        // Calculate task completion rate
        const completionRate = (completedTasks / totalTasks) * 100;
        
        // Calculate project duration (days between creation and last task update)
        const taskDates = tasks.map((t: { updatedAt: Date }) => t.updatedAt.getTime());
        let durationDays = 0;
        
        if (taskDates.length > 0) {
          const latestTaskUpdate = new Date(Math.max(...taskDates));
          const projectStart = project.createdAt;
          durationDays = Math.ceil(
            (latestTaskUpdate.getTime() - projectStart.getTime()) / (1000 * 60 * 60 * 24)
          );
        }
        
        // Calculate total hours logged
        const totalHoursLogged = tasks.reduce((acc: number, task: any) => {
          const timeLogHours = task.timeLogs.reduce((sum: number, log: { hours: number }) => sum + (log.hours || 0), 0);
          const externalLogHours = task.externalLogs.reduce((sum: number, log: { hours: number }) => sum + (log.hours || 0), 0);
          return acc + timeLogHours + externalLogHours;
        }, 0);
        
        // Calculate average hours per task
        const avgHoursPerTask = totalHoursLogged / totalTasks;
        
        kpiData.push({
          type: 'Project',
          name: project.name,
          totalTasks,
          completedTasks,
          pendingTasks,
          inProgressTasks,
          completionRate: completionRate.toFixed(2) + '%',
          durationDays,
          totalHoursLogged: totalHoursLogged.toFixed(2),
          avgHoursPerTask: avgHoursPerTask.toFixed(2)
        });
        
        // Workflow level KPIs
        for (const workflow of project.workflows) {
          const wfTasks = workflow.tasks;
          const wfTotalTasks = wfTasks.length;
          
          if (wfTotalTasks > 0) {
            const wfCompletedTasks = wfTasks.filter((t: { status: string }) => 
              t.status === 'DONE' || t.status === 'COMPLETED').length;
            const wfCompletionRate = (wfCompletedTasks / wfTotalTasks) * 100;
            
            // Calculate total hours logged for this workflow
            const wfTotalHours = wfTasks.reduce((acc: number, task: any) => {
              const timeLogHours = task.timeLogs.reduce((sum: number, log: { hours: number }) => sum + (log.hours || 0), 0);
              const externalLogHours = task.externalLogs.reduce((sum: number, log: { hours: number }) => sum + (log.hours || 0), 0);
              return acc + timeLogHours + externalLogHours;
            }, 0);
            
            kpiData.push({
              type: 'Workflow',
              name: workflow.name,
              projectName: project.name,
              totalTasks: wfTotalTasks,
              completedTasks: wfCompletedTasks,
              completionRate: wfCompletionRate.toFixed(2) + '%',
              totalHoursLogged: wfTotalHours.toFixed(2),
              avgHoursPerTask: (wfTotalHours / wfTotalTasks).toFixed(2)
            });
          }
        }
      }
    }
    
    // Employee performance KPIs
    const employeePerformance: Record<string, {
      id: string;
      name: string;
      totalTasks: number;
      completedTasks: number;
      totalHours: number;
      projectContributions: Record<string, {
        projectName: string;
        tasks: number;
        hours: number;
      }>;
    }> = {};
    
    for (const project of projects) {
      const tasks = project.workflows.flatMap((wf: any) => wf.tasks);
      
      for (const task of tasks) {
        if (task.assignee) {
          const assigneeId = task.assignee.id;
          const assigneeName = task.assignee.name;
          
          if (!employeePerformance[assigneeId]) {
            employeePerformance[assigneeId] = {
              id: assigneeId,
              name: assigneeName,
              totalTasks: 0,
              completedTasks: 0,
              totalHours: 0,
              projectContributions: {}
            };
          }
          
          // Count task
          employeePerformance[assigneeId].totalTasks += 1;
          
          // Count completed task
          if (task.status === 'DONE' || task.status === 'COMPLETED') {
            employeePerformance[assigneeId].completedTasks += 1;
          }
          
          // Sum hours
          const taskTimeLogHours = task.timeLogs
            .filter((log: { userId: string }) => log.userId === assigneeId)
            .reduce((sum: number, log: { hours: number }) => sum + (log.hours || 0), 0);
          
          const taskExternalLogHours = task.externalLogs
            .filter((log: { userId: string | null }) => log.userId === assigneeId)
            .reduce((sum: number, log: { hours: number }) => sum + (log.hours || 0), 0);
          
          const totalTaskHours = taskTimeLogHours + taskExternalLogHours;
          employeePerformance[assigneeId].totalHours += totalTaskHours;
          
          // Track project contributions
          const projectId = project.id;
          if (!employeePerformance[assigneeId].projectContributions[projectId]) {
            employeePerformance[assigneeId].projectContributions[projectId] = {
              projectName: project.name,
              tasks: 0,
              hours: 0
            };
          }
          
          employeePerformance[assigneeId].projectContributions[projectId].tasks += 1;
          employeePerformance[assigneeId].projectContributions[projectId].hours += totalTaskHours;
        }
      }
    }
    
    // Convert employee performance data to flat structure for export
    for (const empId in employeePerformance) {
      const emp = employeePerformance[empId];
      const completionRate = emp.totalTasks > 0 ? (emp.completedTasks / emp.totalTasks) * 100 : 0;
      const efficiency = emp.totalHours > 0 ? (emp.completedTasks / emp.totalHours) * 10 : 0; // tasks per 10 hours
      
      kpiData.push({
        type: 'Employee',
        name: emp.name,
        totalTasks: emp.totalTasks,
        completedTasks: emp.completedTasks,
        completionRate: completionRate.toFixed(2) + '%',
        totalHoursLogged: emp.totalHours.toFixed(2),
        efficiency: efficiency.toFixed(2),
        avgHoursPerTask: emp.totalTasks > 0 ? (emp.totalHours / emp.totalTasks).toFixed(2) : '0.00'
      });
      
      // Add project contribution records
      Object.keys(emp.projectContributions).forEach(projectId => {
        const contrib = emp.projectContributions[projectId];
        
        kpiData.push({
          type: 'Employee-Project',
          name: emp.name,
          projectName: contrib.projectName,
          totalTasks: contrib.tasks,
          totalHoursLogged: contrib.hours.toFixed(2),
          avgHoursPerTask: contrib.tasks > 0 ? (contrib.hours / contrib.tasks).toFixed(2) : '0.00'
        });
      });
    }
    
    // Generate filename with date stamp
    const timestamp = dateFormat(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const filename = `kpi_export_${timestamp}`;
    
    // Return data in requested format
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.json`);
      return res.json({
        exportedAt: new Date().toISOString(),
        totalRecords: kpiData.length,
        data: kpiData
      });
    } else {
      // CSV format (default)
      // Note: Fields list combines all possible fields across different KPI types
      const fields = [
        'type',
        'name',
        'projectName',
        'totalTasks',
        'completedTasks',
        'pendingTasks',
        'inProgressTasks',
        'completionRate',
        'durationDays',
        'totalHoursLogged',
        'avgHoursPerTask',
        'efficiency'
      ];
      
      const parser = new Parser({ fields });
      const csv = parser.parse(kpiData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
      return res.send(csv);
    }
  } catch (error) {
    console.error('Error exporting KPI data:', error);
    return res.status(500).json({ error: 'Failed to export KPI data' });
  }
});

export default router;