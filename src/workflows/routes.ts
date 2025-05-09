import express, { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware, requireRole } from '../auth/middleware';

const router = express.Router();

// Middleware
router.use(authMiddleware);

// Get all workflows for a project
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    // Verify that the project exists and user has access to it
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: req.context?.user?.organizationId
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found or you don\'t have access' });
    }

    const workflows = await prisma.workflow.findMany({
      where: {
        projectId
      },
      orderBy: {
        order: 'asc'
      }
    });

    return res.json(workflows);
  } catch (error) {
    console.error('Error fetching workflows:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get workflow by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const workflow = await prisma.workflow.findFirst({
      where: {
        id,
        project: {
          organizationId: req.context?.user?.organizationId
        }
      },
      include: {
        tasks: {
          orderBy: {
            order: 'asc'
          }
        }
      }
    });

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found or you don\'t have access' });
    }

    return res.json(workflow);
  } catch (error) {
    console.error('Error fetching workflow:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new workflow
router.post('/', requireRole('PROJECT_MANAGER', true), async (req: Request, res: Response) => {
  try {
    const { name, description, projectId, order } = req.body;

    // Validate input
    if (!name || !projectId) {
      return res.status(400).json({ error: 'Name and projectId are required' });
    }

    // Verify that the project exists and user has access to it
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: req.context?.user?.organizationId
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found or you don\'t have access' });
    }

    const workflow = await prisma.workflow.create({
      data: {
        name,
        description,
        projectId,
        ownerId: req.context?.user?.userId!,
        order: order || 0
      }
    });

    return res.status(201).json(workflow);
  } catch (error) {
    console.error('Error creating workflow:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a workflow
router.put('/:id', requireRole('PROJECT_MANAGER', true), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, order, status } = req.body;

    // Find the workflow to verify access
    const existingWorkflow = await prisma.workflow.findFirst({
      where: {
        id,
        project: {
          organizationId: req.context?.user?.organizationId
        }
      }
    });

    if (!existingWorkflow) {
      return res.status(404).json({ error: 'Workflow not found or you don\'t have access' });
    }

    const workflow = await prisma.workflow.update({
      where: { id },
      data: {
        name,
        description,
        order,
        status
      }
    });

    return res.json(workflow);
  } catch (error) {
    console.error('Error updating workflow:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a workflow
router.delete('/:id', requireRole('PROJECT_MANAGER', true), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Find the workflow to verify access
    const existingWorkflow = await prisma.workflow.findFirst({
      where: {
        id,
        project: {
          organizationId: req.context?.user?.organizationId
        }
      },
      include: {
        tasks: true
      }
    });

    if (!existingWorkflow) {
      return res.status(404).json({ error: 'Workflow not found or you don\'t have access' });
    }

    // Check if the workflow has tasks
    if (existingWorkflow.tasks.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete workflow with tasks. Please delete or move all tasks first.' 
      });
    }

    await prisma.workflow.delete({
      where: { id }
    });

    return res.json({ message: 'Workflow deleted successfully' });
  } catch (error) {
    console.error('Error deleting workflow:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 