import express, { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { authMiddleware, requireRole } from '../auth/middleware';
import { logAction, getUserIdFromRequest, auditAPIAction } from '../utils/auditLogger';

const router = express.Router();

// Middleware
router.use(authMiddleware);
router.use(auditAPIAction('Task'));

// Get all tasks for a workflow
router.get('/workflow/:workflowId', async (req: Request, res: Response) => {
  try {
    const { workflowId } = req.params;

    // Verify that the workflow exists and user has access to it
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: workflowId,
        project: {
          organizationId: req.context?.user?.organizationId
        }
      }
    });

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found or you don\'t have access' });
    }

    const tasks = await prisma.task.findMany({
      where: {
        workflowId
      },
      orderBy: {
        order: 'asc'
      },
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        dependencies: {
          include: {
            dependsOn: {
              select: {
                id: true,
                title: true,
                status: true
              }
            }
          }
        }
      }
    });

    return res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get task by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const task = await prisma.task.findFirst({
      where: {
        id,
        workflow: {
          project: {
            organizationId: req.context?.user?.organizationId
          }
        }
      },
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        dependencies: {
          include: {
            dependsOn: {
              select: {
                id: true,
                title: true,
                status: true
              }
            }
          }
        },
        dependents: {
          include: {
            task: {
              select: {
                id: true,
                title: true,
                status: true
              }
            }
          }
        }
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found or you don\'t have access' });
    }

    return res.json(task);
  } catch (error) {
    console.error('Error fetching task:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new task
router.post('/', requireRole(['USER', 'PROJECT_MANAGER'], true), async (req: Request, res: Response) => {
  try {
    const { title, description, workflowId, assigneeId, status, priority, dueDate, order } = req.body;

    // Validate input
    if (!title || !workflowId) {
      return res.status(400).json({ error: 'Title and workflowId are required' });
    }

    // Verify that the workflow exists and user has access to it
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: workflowId,
        project: {
          organizationId: req.context?.user?.organizationId
        }
      }
    });

    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found or you don\'t have access' });
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        workflowId,
        assigneeId: assigneeId || null,
        status: status || 'TODO',
        priority: priority || 'MEDIUM',
        dueDate: dueDate ? new Date(dueDate) : null,
        order: order || 0
      }
    });

    // Log the create action manually (alternative to middleware approach)
    const userId = req.context?.user?.userId;
    if (userId) {
      await logAction(
        userId,
        'CREATE',
        'Task',
        task.id,
        { newData: task }
      );
    }

    return res.status(201).json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a task (full update)
router.put('/:id', requireRole(['USER', 'PROJECT_MANAGER'], true), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, assigneeId, status, priority, dueDate, order } = req.body;

    // Find the task to verify access
    const existingTask = await prisma.task.findFirst({
      where: {
        id,
        workflow: {
          project: {
            organizationId: req.context?.user?.organizationId
          }
        }
      }
    });

    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found or you don\'t have access' });
    }

    // Special case for changing status to IN_PROGRESS - must check dependencies
    if (status === 'IN_PROGRESS' && existingTask.status !== 'IN_PROGRESS') {
      const taskWithDeps = await prisma.task.findUnique({
        where: { id },
        include: {
          dependencies: {
            include: {
              dependsOn: true
            }
          }
        }
      });

      if (taskWithDeps?.dependencies.some((dep: any) => dep.dependsOn.status !== 'COMPLETED' && dep.dependsOn.status !== 'DONE')) {
        return res.status(400).json({
          error: 'Cannot start task before dependencies are completed'
        });
      }
    }

    // Log the old state before update
    const userId = req.context?.user?.userId;
    
    const task = await prisma.task.update({
      where: { id },
      data: {
        title,
        description,
        assigneeId,
        status,
        priority,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        order
      }
    });

    // Log the update action manually
    if (userId) {
      await logAction(
        userId,
        'UPDATE',
        'Task',
        id,
        { 
          oldData: existingTask,
          newData: task 
        }
      );
    }

    return res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a task (partial update)
router.patch('/:id', requireRole(['USER', 'PROJECT_MANAGER'], true), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Find the task to verify access
    const existingTask = await prisma.task.findFirst({
      where: {
        id,
        workflow: {
          project: {
            organizationId: req.context?.user?.organizationId
          }
        }
      }
    });

    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found or you don\'t have access' });
    }

    // Special case for changing status to IN_PROGRESS - must check dependencies
    if (updates.status === 'IN_PROGRESS' && existingTask.status !== 'IN_PROGRESS') {
      const taskWithDeps = await prisma.task.findUnique({
        where: { id },
        include: {
          dependencies: {
            include: {
              dependsOn: true
            }
          }
        }
      });

      if (taskWithDeps?.dependencies.some((dep: any) => dep.dependsOn.status !== 'COMPLETED' && dep.dependsOn.status !== 'DONE')) {
        return res.status(400).json({
          error: 'Cannot start task before dependencies are completed'
        });
      }
    }

    // Process date if it exists
    if (updates.dueDate) {
      updates.dueDate = new Date(updates.dueDate);
    }

    const task = await prisma.task.update({
      where: { id },
      data: updates
    });

    // Log the update action manually
    const userId = req.context?.user?.userId;
    if (userId) {
      await logAction(
        userId,
        'UPDATE',
        'Task',
        id,
        {
          oldData: existingTask,
          updatedFields: updates,
          newData: task
        }
      );
    }

    return res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a task
router.delete('/:id', requireRole(['USER', 'PROJECT_MANAGER'], true), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Find the task to verify access
    const existingTask = await prisma.task.findFirst({
      where: {
        id,
        workflow: {
          project: {
            organizationId: req.context?.user?.organizationId
          }
        }
      },
      include: {
        dependents: true
      }
    });

    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found or you don\'t have access' });
    }

    // First, delete any task dependencies
    await prisma.taskDependency.deleteMany({
      where: {
        OR: [
          { taskId: id },
          { dependsOnId: id }
        ]
      }
    });

    // Then, delete the task
    await prisma.task.delete({
      where: { id }
    });

    // Log the delete action manually
    const userId = req.context?.user?.userId;
    if (userId) {
      await logAction(
        userId,
        'DELETE',
        'Task',
        id,
        { deletedData: existingTask }
      );
    }

    return res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Add dependency to a task
router.post('/:taskId/dependencies/:dependsOnId', requireRole(['USER', 'PROJECT_MANAGER'], true), async (req: Request, res: Response) => {
  try {
    const { taskId, dependsOnId } = req.params;

    // Can't depend on itself
    if (taskId === dependsOnId) {
      return res.status(400).json({ error: 'A task cannot depend on itself' });
    }

    // Verify both tasks exist and user has access
    const [task, dependsOnTask] = await Promise.all([
      prisma.task.findFirst({
        where: {
          id: taskId,
          workflow: {
            project: {
              organizationId: req.context?.user?.organizationId
            }
          }
        }
      }),
      prisma.task.findFirst({
        where: {
          id: dependsOnId,
          workflow: {
            project: {
              organizationId: req.context?.user?.organizationId
            }
          }
        }
      })
    ]);

    if (!task || !dependsOnTask) {
      return res.status(404).json({ error: 'One or both tasks not found or you don\'t have access' });
    }

    // Check for circular dependencies
    // This is a simplified check - a more comprehensive check would need to traverse the full dependency graph
    const reverseCheck = await prisma.taskDependency.findFirst({
      where: {
        taskId: dependsOnId,
        dependsOnId: taskId
      }
    });

    if (reverseCheck) {
      return res.status(400).json({ error: 'Adding this dependency would create a circular reference' });
    }

    // Create the dependency
    const dependency = await prisma.taskDependency.create({
      data: {
        taskId,
        dependsOnId
      }
    });

    return res.status(201).json(dependency);
  } catch (error: any) {
    // Handle unique constraint violation
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'This dependency already exists' });
    }
    
    console.error('Error adding dependency:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove dependency from a task
router.delete('/:taskId/dependencies/:dependsOnId', requireRole(['USER', 'PROJECT_MANAGER'], true), async (req: Request, res: Response) => {
  try {
    const { taskId, dependsOnId } = req.params;

    // Verify task exists and user has access
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        workflow: {
          project: {
            organizationId: req.context?.user?.organizationId
          }
        }
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found or you don\'t have access' });
    }

    // Find and delete the dependency
    const dependency = await prisma.taskDependency.findFirst({
      where: {
        taskId,
        dependsOnId
      }
    });

    if (!dependency) {
      return res.status(404).json({ error: 'Dependency not found' });
    }

    await prisma.taskDependency.delete({
      where: {
        id: dependency.id
      }
    });

    return res.json({ message: 'Dependency removed successfully' });
  } catch (error) {
    console.error('Error removing dependency:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;