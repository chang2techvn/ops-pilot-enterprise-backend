import express, { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireRole } from '../auth/middleware';
import { startOfWeek, endOfWeek, parseISO, addHours, differenceInMinutes } from 'date-fns';

const router = express.Router();

// Get timelogs for current user
router.get('/me', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const timelogs = await prisma.timeLog.findMany({
      where: {
        userId: req.context!.user!.userId
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
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
        }
      },
      orderBy: { 
        date: 'desc' 
      }
    });

    res.json(timelogs);
  } catch (error) {
    console.error('Error fetching time logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get timelogs for a specific task
router.get('/task/:taskId', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    const timelogs = await prisma.timeLog.findMany({
      where: {
        taskId
      },
      include: {
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

    res.json(timelogs);
  } catch (error) {
    console.error('Error fetching task time logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new time log entry
router.post('/', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { taskId, date, hours, startTime, endTime, notes } = req.body;
    const userId = req.context!.user!.userId;

    // Validate input
    if (!taskId || !hours || hours <= 0) {
      return res.status(400).json({ error: 'Task ID and hours are required. Hours must be greater than 0.' });
    }

    // Check if task exists and user has access to it
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        workflow: {
          project: {
            organizationId: req.context!.user!.organizationId
          }
        }
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found or you don\'t have access to it' });
    }

    // Parse date from the request or use current date
    let logDate = new Date();
    if (date) {
      logDate = parseISO(date);
    }
    
    // Calculate duration in minutes if both startTime and endTime are provided
    let duration = null;
    if (startTime && endTime) {
      const start = parseISO(startTime);
      const end = parseISO(endTime);
      duration = differenceInMinutes(end, start);
    }

    // Create time log entry
    const timeLog = await prisma.timeLog.create({
      data: {
        taskId,
        userId,
        date: logDate,
        hours: parseFloat(hours),
        startTime: startTime ? parseISO(startTime) : logDate,
        endTime: endTime ? parseISO(endTime) : null,
        duration,
        notes
      }
    });

    // Check weekly capacity after creating a new time log
    const weeklyCapacityWarning = await checkWeeklyCapacity(userId, logDate);

    res.status(201).json({
      timeLog,
      weeklyCapacityWarning
    });
  } catch (error) {
    console.error('Error creating time log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a time log entry
router.patch('/:id', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { hours, startTime, endTime, notes } = req.body;
    const userId = req.context!.user!.userId;

    // Check if time log exists and belongs to the user
    const existingLog = await prisma.timeLog.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!existingLog) {
      return res.status(404).json({ error: 'Time log not found or you don\'t have permission to modify it' });
    }

    // Calculate duration in minutes if both startTime and endTime are provided
    let duration = existingLog.duration;
    if (startTime && endTime) {
      const start = parseISO(startTime);
      const end = parseISO(endTime);
      duration = differenceInMinutes(end, start);
    }

    // Update time log
    const updatedLog = await prisma.timeLog.update({
      where: { id },
      data: {
        hours: hours ? parseFloat(hours) : undefined,
        startTime: startTime ? parseISO(startTime) : undefined,
        endTime: endTime ? parseISO(endTime) : undefined,
        duration,
        notes
      }
    });

    // Check weekly capacity after updating the time log
    const weeklyCapacityWarning = await checkWeeklyCapacity(userId, existingLog.date);

    res.json({
      timeLog: updatedLog,
      weeklyCapacityWarning
    });
  } catch (error) {
    console.error('Error updating time log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a time log entry
router.delete('/:id', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.context!.user!.userId;

    // Check if time log exists and belongs to the user
    const existingLog = await prisma.timeLog.findFirst({
      where: {
        id,
        userId
      }
    });

    if (!existingLog) {
      return res.status(404).json({ error: 'Time log not found or you don\'t have permission to delete it' });
    }

    // Store the date before deleting
    const logDate = existingLog.date;

    // Delete time log
    await prisma.timeLog.delete({
      where: { id }
    });

    // Check weekly capacity after deleting the time log
    const weeklyCapacityWarning = await checkWeeklyCapacity(userId, logDate);

    res.json({
      success: true,
      weeklyCapacityWarning
    });
  } catch (error) {
    console.error('Error deleting time log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get weekly summary for the current user
router.get('/weekly-summary', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const userId = req.context!.user!.userId;
    const dateParam = req.query.date as string | undefined;
    
    // Use provided date or current date
    const baseDate = dateParam ? parseISO(dateParam) : new Date();
    
    // Get start and end of the week for the given date
    const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 }); // Week starts on Monday (1)
    const weekEnd = endOfWeek(baseDate, { weekStartsOn: 1 });

    // Get time logs for the week
    const logs = await prisma.timeLog.findMany({
      where: {
        userId,
        date: { 
          gte: weekStart,
          lte: weekEnd
        }
      },
      include: {
        task: {
          select: {
            title: true,
            workflow: {
              select: {
                name: true,
                project: {
                  select: {
                    name: true
                  }
                }
              }
            }
          }
        }
      }
    });

    // Calculate total hours
    const totalHours = logs.reduce((sum: number, log: any) => sum + log.hours, 0);

    // Check for warnings
    let warning = null;
    if (totalHours > 40) {
      warning = 'Warning: You have logged more than 40 hours this week';
    } else if (totalHours < 20) {
      warning = 'Warning: You have logged less than 20 hours this week';
    }

    // Aggregate logs by tasks for the summary
    const taskSummary = logs.reduce((acc: Record<string, any>, log: any) => {
      const taskId = log.taskId;
      if (!acc[taskId]) {
        acc[taskId] = {
          taskId,
          taskTitle: log.task.title,
          projectName: log.task.workflow.project.name,
          workflowName: log.task.workflow.name,
          totalHours: 0,
          entries: []
        };
      }
      
      acc[taskId].totalHours += log.hours;
      acc[taskId].entries.push({
        id: log.id,
        date: log.date,
        hours: log.hours,
        notes: log.notes
      });
      
      return acc;
    }, {} as Record<string, any>);

    res.json({
      weekStart,
      weekEnd,
      totalHours,
      warning,
      tasks: Object.values(taskSummary)
    });
  } catch (error) {
    console.error('Error getting weekly summary:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to check weekly capacity and generate warning if needed
async function checkWeeklyCapacity(userId: string, date: Date): Promise<string | null> {
  try {
    // Get start and end of the week for the given date
    const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Week starts on Monday (1)
    const weekEnd = endOfWeek(date, { weekStartsOn: 1 });

    // Get all time logs for the user in this week
    const logs = await prisma.timeLog.findMany({
      where: {
        userId,
        date: { 
          gte: weekStart,
          lte: weekEnd
        }
      }
    });

    // Calculate total hours
    const totalHours = logs.reduce((sum: number, log: any) => sum + log.hours, 0);

    // Generate warning based on total hours
    if (totalHours > 40) {
      return `Warning: You have logged ${totalHours.toFixed(1)} hours this week, which exceeds the recommended 40 hours.`;
    } else if (totalHours < 20) {
      return `Warning: You have logged ${totalHours.toFixed(1)} hours this week, which is less than the recommended 20 hours.`;
    }

    return null;
  } catch (error) {
    console.error('Error checking weekly capacity:', error);
    return 'Error checking weekly capacity';
  }
}

export default router;