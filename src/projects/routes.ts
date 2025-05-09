import express, { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireRole } from '../auth/middleware';

const router = express.Router();

// Get all projects in the current organization
router.get('/', requireRole('USER', true), async (req: Request, res: Response) => {
  try {
    // Get organization ID from context (org context required by middleware)
    const organizationId = req.context!.user!.organizationId;
    
    // Apply organization-level filtering to query
    const projects = await prisma.project.findMany({
      where: {
        organizationId,
        status: { not: 'DELETED' } // Default filter to exclude deleted projects
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific project
router.get('/:id', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // First, ensure the project belongs to the user's organization
    const project = await prisma.project.findFirst({
      where: {
        id,
        organizationId: req.context!.user!.organizationId
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        tasks: {
          where: {
            status: { not: 'DONE' }
          },
          orderBy: {
            priority: 'desc'
          },
          take: 5 // Just get top 5 active tasks
        }
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new project
router.post('/', requireRole('USER', true), async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    
    // Validate input
    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    // Always set the organizationId from the context
    const project = await prisma.project.create({
      data: {
        name,
        description,
        organizationId: req.context!.user!.organizationId!, // Enforce tenant isolation
        ownerId: req.context!.user!.userId
      }
    });

    res.status(201).json(project);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a project
router.patch('/:id', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, status } = req.body;
    
    // First check if project exists and belongs to user's organization
    const existingProject = await prisma.project.findFirst({
      where: {
        id,
        organizationId: req.context!.user!.organizationId
      }
    });

    if (!existingProject) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Update project
    const project = await prisma.project.update({
      where: { id },
      data: {
        name,
        description,
        status
      }
    });

    res.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a project (soft delete by changing status)
router.delete('/:id', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // First check if project exists and belongs to user's organization
    const existingProject = await prisma.project.findFirst({
      where: {
        id,
        organizationId: req.context!.user!.organizationId
      }
    });

    if (!existingProject) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Just mark as deleted (soft delete)
    await prisma.project.update({
      where: { id },
      data: { status: 'DELETED' }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 