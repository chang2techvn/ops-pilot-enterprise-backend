import express, { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireRole } from '../auth/middleware';

const router = express.Router();

// Get audit logs (admin only)
router.get('/', requireRole('ADMIN'), async (_req: Request, res: Response) => {
  try {
    const auditLogs = await prisma.auditLog.findMany({
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
        createdAt: 'desc' 
      },
      take: 100 // Limit to latest 100 logs
    });

    res.json(auditLogs);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 