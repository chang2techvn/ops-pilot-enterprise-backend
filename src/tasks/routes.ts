import express, { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireRole } from '../auth/middleware';

const router = express.Router();

// Get all tasks for a project
router.get('/project/:projectId', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    
    // First check if project exists and belongs to user's organization
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: req.context!.user!.organizationId
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get all tasks for this project
    const tasks = await prisma.task.findMany({
      where: {
        projectId
      },
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' }
      ]
    });

    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 