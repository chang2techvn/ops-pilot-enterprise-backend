import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import fsExtra from 'fs-extra';
import csv from 'csv-parser';
import prisma from '../lib/prisma';
import { requireRole } from '../auth/middleware';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    // Ensure the directory exists
    fsExtra.ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

// Filter to only allow CSV files
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
    cb(null, true);
  } else {
    cb(null, false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const router = express.Router();

// Upload CSV of external time logs
router.post('/upload', requireRole(['ADMIN', 'PROJECT_MANAGER'], true), upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded or invalid file format. Please upload a CSV file.' });
    }

    const filePath = req.file.path;
    const source = req.body.source || 'External System'; // Source system name
    const organizationId = req.context!.user!.organizationId!;
    
    const results: { processed: number, skipped: number, errors: string[] } = {
      processed: 0,
      skipped: 0,
      errors: []
    };

    // Process the CSV file
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', async (row) => {
          try {
            // Check required fields
            if (!row.projectCode || !row.date || !row.hours || !row.userName) {
              results.errors.push(`Row missing required fields: ${JSON.stringify(row)}`);
              results.skipped++;
              return;
            }

            // Find matching task by externalCode within the organization
            const task = await prisma.task.findFirst({
              where: {
                externalCode: row.projectCode,
                workflow: {
                  project: {
                    organizationId
                  }
                }
              }
            });

            if (!task) {
              results.errors.push(`No matching task found for project code: ${row.projectCode}`);
              results.skipped++;
              return;
            }

            // Try to match with internal user by name (optional)
            let userId = null;
            const user = await prisma.user.findFirst({
              where: {
                name: { contains: row.userName, mode: 'insensitive' }
              }
            });

            if (user) {
              userId = user.id;
            }

            // Create external log
            await prisma.externalLog.create({
              data: {
                taskId: task.id,
                userId: userId,
                userName: row.userName,
                date: new Date(row.date),
                hours: parseFloat(row.hours),
                description: row.description || null,
                source: source,
                externalId: row.externalId || null,
                projectCode: row.projectCode,
                billable: row.billable?.toLowerCase() === 'true' || row.billable === '1' || true
              }
            });

            results.processed++;
          } catch (error) {
            results.errors.push(`Error processing row: ${JSON.stringify(row)} - ${error}`);
            results.skipped++;
          }
        })
        .on('end', () => {
          // Cleanup - remove the uploaded file
          fs.unlink(filePath, (err) => {
            if (err) console.error('Error removing uploaded file:', err);
          });
          resolve();
        })
        .on('error', (error) => {
          reject(error);
        });
    });

    res.status(200).json({
      message: 'CSV processing completed',
      results
    });
  } catch (error) {
    console.error('Error processing CSV upload:', error);
    res.status(500).json({ error: 'Internal server error processing the CSV file' });
  }
});

// Get external time logs for the current user's organization
router.get('/', requireRole(['USER', 'PROJECT_MANAGER', 'ADMIN'], true), async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, taskId } = req.query;
    const organizationId = req.context!.user!.organizationId!;
    
    // Build filter conditions
    const where: any = {
      task: {
        workflow: {
          project: {
            organizationId
          }
        }
      }
    };
    
    if (taskId) {
      where.taskId = taskId as string;
    }
    
    if (startDate) {
      where.date = { 
        ...(where.date || {}),
        gte: new Date(startDate as string) 
      };
    }
    
    if (endDate) {
      where.date = {
        ...(where.date || {}),
        lte: new Date(endDate as string)
      };
    }
    
    const externalLogs = await prisma.externalLog.findMany({
      where,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            externalCode: true,
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
    
    res.json(externalLogs);
  } catch (error) {
    console.error('Error fetching external logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get combined time tracking report (internal + external)
router.get('/combined-report', requireRole(['USER', 'PROJECT_MANAGER', 'ADMIN'], true), async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, userId } = req.query;
    const organizationId = req.context!.user!.organizationId!;
    
    // Default date range to current month if not provided
    const today = new Date();
    const defaultStartDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const defaultEndDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    const start = startDate ? new Date(startDate as string) : defaultStartDate;
    const end = endDate ? new Date(endDate as string) : defaultEndDate;
    
    // Internal time logs query
    const internalTimeFilter: any = {
      date: {
        gte: start,
        lte: end
      },
      task: {
        workflow: {
          project: {
            organizationId
          }
        }
      }
    };
    
    // External time logs query
    const externalTimeFilter: any = {
      date: {
        gte: start,
        lte: end
      },
      task: {
        workflow: {
          project: {
            organizationId
          }
        }
      }
    };
    
    // Add user filter if provided
    if (userId) {
      internalTimeFilter.userId = userId;
      externalTimeFilter.userId = userId;
    }
    
    // Get internal time logs
    const internalLogs = await prisma.timeLog.findMany({
      where: internalTimeFilter,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            workflow: {
              select: {
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
      }
    });
    
    // Get external time logs
    const externalLogs = await prisma.externalLog.findMany({
      where: externalTimeFilter,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            workflow: {
              select: {
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
      }
    });
    
    // Combine and format the data
    const projectSummary: Record<string, any> = {};
    const userSummary: Record<string, any> = {};
    
    // Process internal logs
    internalLogs.forEach((log: any) => {
      const projectId = log.task.workflow.project.id;
      const projectName = log.task.workflow.project.name;
      const taskId = log.taskId;
      const taskName = log.task.title;
      const userId = log.userId;
      const userName = log.user.name;
      
      // Add to project summary
      if (!projectSummary[projectId]) {
        projectSummary[projectId] = {
          projectId,
          projectName,
          tasks: {},
          totalHours: 0,
          internalHours: 0,
          externalHours: 0
        };
      }
      
      if (!projectSummary[projectId].tasks[taskId]) {
        projectSummary[projectId].tasks[taskId] = {
          taskId,
          taskName,
          internalHours: 0,
          externalHours: 0,
          totalHours: 0
        };
      }
      
      projectSummary[projectId].totalHours += log.hours;
      projectSummary[projectId].internalHours += log.hours;
      projectSummary[projectId].tasks[taskId].internalHours += log.hours;
      projectSummary[projectId].tasks[taskId].totalHours += log.hours;
      
      // Add to user summary
      if (!userSummary[userId]) {
        userSummary[userId] = {
          userId,
          userName,
          internalHours: 0,
          externalHours: 0,
          totalHours: 0,
          projects: {}
        };
      }
      
      userSummary[userId].internalHours += log.hours;
      userSummary[userId].totalHours += log.hours;
      
      if (!userSummary[userId].projects[projectId]) {
        userSummary[userId].projects[projectId] = {
          projectId,
          projectName,
          internalHours: 0,
          externalHours: 0,
          totalHours: 0
        };
      }
      
      userSummary[userId].projects[projectId].internalHours += log.hours;
      userSummary[userId].projects[projectId].totalHours += log.hours;
    });
    
    // Process external logs
    externalLogs.forEach((log : any) => {
      const projectId = log.task.workflow.project.id;
      const projectName = log.task.workflow.project.name;
      const taskId = log.taskId;
      const taskName = log.task.title;
      const userId = log.userId || `external_${log.userName.replace(/\s+/g, '_')}`;
      const userName = log.userName;
      
      // Add to project summary
      if (!projectSummary[projectId]) {
        projectSummary[projectId] = {
          projectId,
          projectName,
          tasks: {},
          totalHours: 0,
          internalHours: 0,
          externalHours: 0
        };
      }
      
      if (!projectSummary[projectId].tasks[taskId]) {
        projectSummary[projectId].tasks[taskId] = {
          taskId,
          taskName,
          internalHours: 0,
          externalHours: 0,
          totalHours: 0
        };
      }
      
      projectSummary[projectId].totalHours += log.hours;
      projectSummary[projectId].externalHours += log.hours;
      projectSummary[projectId].tasks[taskId].externalHours += log.hours;
      projectSummary[projectId].tasks[taskId].totalHours += log.hours;
      
      // Add to user summary
      if (!userSummary[userId]) {
        userSummary[userId] = {
          userId,
          userName,
          internalHours: 0,
          externalHours: 0,
          totalHours: 0,
          projects: {},
          isExternal: !log.userId
        };
      }
      
      userSummary[userId].externalHours += log.hours;
      userSummary[userId].totalHours += log.hours;
      
      if (!userSummary[userId].projects[projectId]) {
        userSummary[userId].projects[projectId] = {
          projectId,
          projectName,
          internalHours: 0,
          externalHours: 0,
          totalHours: 0
        };
      }
      
      userSummary[userId].projects[projectId].externalHours += log.hours;
      userSummary[userId].projects[projectId].totalHours += log.hours;
    });
    
    // Format the summary for the response
    const formattedProjectSummary = Object.values(projectSummary).map((project: any) => ({
      ...project,
      tasks: Object.values(project.tasks)
    }));
    
    const formattedUserSummary = Object.values(userSummary).map((user: any) => ({
      ...user,
      projects: Object.values(user.projects)
    }));
    
    res.json({
      dateRange: {
        start,
        end
      },
      totalInternal: internalLogs.reduce((sum: number, log: any) => sum + log.hours, 0),
      totalExternal: externalLogs.reduce((sum: number, log: any) => sum + log.hours, 0),
      totalHours: internalLogs.reduce((sum: number, log: any) => sum + log.hours, 0) + 
                  externalLogs.reduce((sum: number, log: any) => sum + log.hours, 0),
      projectSummary: formattedProjectSummary,
      userSummary: formattedUserSummary,
      internalLogs,
      externalLogs
    });
  } catch (error) {
    console.error('Error generating combined report:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;