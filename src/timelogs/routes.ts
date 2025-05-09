import express, { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireRole } from '../auth/middleware';

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
            project: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: { 
        startTime: 'desc' 
      }
    });

    res.json(timelogs);
  } catch (error) {
    console.error('Error fetching time logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 