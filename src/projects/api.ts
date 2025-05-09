// @ts-ignore
import * as encore from 'encore.dev';
// @ts-ignore
import client from '@prisma/client';
import { authMiddleware, requireRole } from '../auth/middleware';

// @ts-ignore
const PrismaClient = client?.PrismaClient || client;
const prisma = new PrismaClient();

// Define API
const api = encore.createAPI({
  name: 'projects',
  middleware: [authMiddleware]
});

// Define request and response types
interface CreateProjectRequest {
  name: string;
  description?: string;
}

interface UpdateProjectRequest {
  name?: string;
  description?: string;
  status?: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
}

/**
 * Get all projects in the current organization
 * Demonstrates the multi-tenant filtering pattern
 */
api.endpoint('getProjects', {
  method: 'GET',
  path: '/projects',
  middleware: [requireRole('USER', true)], // Requires org context
  handler: async (req: any, context: any): Promise<any> => {
    // Get organization ID from context (org context required by middleware)
    const organizationId = context.user.organizationId;
    
    // Apply organization-level filtering to query
    const projects = await prisma.project.findMany({
      where: {
        organizationId: organizationId,
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

    return projects;
  }
});

/**
 * Get a specific project
 * Shows how to enforce tenant isolation for specific resources
 */
api.endpoint('getProject', {
  method: 'GET',
  path: '/projects/:id',
  middleware: [requireRole('USER')],
  handler: async (req: { id: string }, context: any): Promise<any> => {
    // First, ensure the project belongs to the user's organization
    const project = await prisma.project.findFirst({
      where: {
        id: req.id,
        organizationId: context.user.organizationId
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
      throw encore.createError({
        statusCode: 404,
        message: 'Project not found'
      });
    }

    return project;
  }
});

/**
 * Create a new project
 */
api.endpoint('createProject', {
  method: 'POST',
  path: '/projects',
  middleware: [requireRole('USER', true)], // Requires org context
  handler: async (req: CreateProjectRequest, context: any): Promise<any> => {
    // Validate input
    if (!req.name) {
      throw encore.createError({
        statusCode: 400,
        message: 'Project name is required'
      });
    }

    // Always set the organizationId from the context
    const project = await prisma.project.create({
      data: {
        name: req.name,
        description: req.description,
        organizationId: context.user.organizationId, // Enforce tenant isolation
        ownerId: context.user.userId
      }
    });

    return project;
  }
});

/**
 * Update a project
 */
api.endpoint('updateProject', {
  method: 'PATCH',
  path: '/projects/:id',
  middleware: [requireRole('USER')],
  handler: async (req: UpdateProjectRequest & { id: string }, context: any): Promise<any> => {
    // First check if project exists and belongs to user's organization
    const existingProject = await prisma.project.findFirst({
      where: {
        id: req.id,
        organizationId: context.user.organizationId
      }
    });

    if (!existingProject) {
      throw encore.createError({
        statusCode: 404,
        message: 'Project not found'
      });
    }

    // Update project
    const project = await prisma.project.update({
      where: { id: req.id },
      data: {
        name: req.name,
        description: req.description,
        status: req.status
      }
    });

    return project;
  }
});

/**
 * Delete a project (soft delete by changing status)
 */
api.endpoint('deleteProject', {
  method: 'DELETE',
  path: '/projects/:id',
  middleware: [requireRole('USER')],
  handler: async (req: { id: string }, context: any): Promise<any> => {
    // First check if project exists and belongs to user's organization
    const existingProject = await prisma.project.findFirst({
      where: {
        id: req.id,
        organizationId: context.user.organizationId
      }
    });

    if (!existingProject) {
      throw encore.createError({
        statusCode: 404,
        message: 'Project not found'
      });
    }

    // Just mark as deleted (soft delete)
    await prisma.project.update({
      where: { id: req.id },
      data: { status: 'DELETED' }
    });

    return { success: true };
  }
});

export default api; 