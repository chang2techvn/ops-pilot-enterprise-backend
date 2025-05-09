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
  name: 'organizations',
  middleware: [authMiddleware]
});

// Define request and response types
interface CreateOrgRequest {
  name: string;
  description?: string;
}

interface UpdateOrgRequest {
  name?: string;
  description?: string;
}

interface AddUserRequest {
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

/**
 * Create a new organization
 */
api.endpoint('createOrganization', {
  method: 'POST',
  path: '/organizations',
  middleware: [requireRole('USER')], // Any authenticated user can create an org
  handler: async (req: CreateOrgRequest, context: any): Promise<any> => {
    // Check if user is authenticated
    if (!context.user?.userId) {
      throw encore.createError({
        statusCode: 401,
        message: 'Authentication required'
      });
    }

    // Validate input
    if (!req.name) {
      throw encore.createError({
        statusCode: 400,
        message: 'Organization name is required'
      });
    }

    // Create organization and add current user as owner in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Create the organization
      const org = await tx.organization.create({
        data: {
          name: req.name,
          description: req.description
        }
      });

      // Add the current user as owner
      await tx.userOrg.create({
        data: {
          userId: context.user.userId,
          organizationId: org.id,
          role: 'OWNER'
        }
      });

      return org;
    });

    return result;
  }
});

/**
 * Get all organizations the current user is a member of
 */
api.endpoint('getMyOrganizations', {
  method: 'GET',
  path: '/organizations',
  middleware: [requireRole('USER')],
  handler: async (req: any, context: any): Promise<any> => {
    // Check if user is authenticated
    if (!context.user?.userId) {
      throw encore.createError({
        statusCode: 401,
        message: 'Authentication required'
      });
    }

    // Get user's organizations
    const userOrgs = await prisma.userOrg.findMany({
      where: { userId: context.user.userId },
      include: {
        organization: true
      }
    });

    return userOrgs.map((uo: any) => ({
      id: uo.organization.id,
      name: uo.organization.name,
      description: uo.organization.description,
      role: uo.role,
      createdAt: uo.organization.createdAt
    }));
  }
});

/**
 * Get a specific organization
 */
api.endpoint('getOrganization', {
  method: 'GET',
  path: '/organizations/:id',
  middleware: [requireRole('USER')],
  handler: async (req: { id: string }, context: any): Promise<any> => {
    // Check if user is authenticated
    if (!context.user?.userId) {
      throw encore.createError({
        statusCode: 401,
        message: 'Authentication required'
      });
    }

    // Check if user has access to this organization
    const userOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: context.user.userId,
          organizationId: req.id
        }
      }
    });

    if (!userOrg) {
      throw encore.createError({
        statusCode: 403,
        message: 'You do not have access to this organization'
      });
    }

    // Get organization
    const org = await prisma.organization.findUnique({
      where: { id: req.id },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        }
      }
    });

    if (!org) {
      throw encore.createError({
        statusCode: 404,
        message: 'Organization not found'
      });
    }

    return {
      id: org.id,
      name: org.name,
      description: org.description,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      members: org.users.map((u: any) => ({
        id: u.user.id,
        name: u.user.name,
        email: u.user.email,
        role: u.role
      })),
      currentUserRole: userOrg.role
    };
  }
});

/**
 * Update an organization
 */
api.endpoint('updateOrganization', {
  method: 'PATCH',
  path: '/organizations/:id',
  middleware: [requireRole('USER')],
  handler: async (req: UpdateOrgRequest & { id: string }, context: any): Promise<any> => {
    // Check if user has access to this organization
    const userOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: context.user.userId,
          organizationId: req.id
        }
      }
    });

    if (!userOrg || (userOrg.role !== 'OWNER' && userOrg.role !== 'ADMIN')) {
      throw encore.createError({
        statusCode: 403,
        message: 'You do not have permission to update this organization'
      });
    }

    // Update organization
    const org = await prisma.organization.update({
      where: { id: req.id },
      data: {
        name: req.name,
        description: req.description
      }
    });

    return org;
  }
});

/**
 * Add a user to an organization
 */
api.endpoint('addUserToOrganization', {
  method: 'POST',
  path: '/organizations/:id/users',
  middleware: [requireRole('USER')],
  handler: async (req: AddUserRequest & { id: string }, context: any): Promise<any> => {
    // Check if user has admin access to this organization
    const userOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: context.user.userId,
          organizationId: req.id
        }
      }
    });

    if (!userOrg || (userOrg.role !== 'OWNER' && userOrg.role !== 'ADMIN')) {
      throw encore.createError({
        statusCode: 403,
        message: 'You do not have permission to add users to this organization'
      });
    }

    // Find user by email
    const userToAdd = await prisma.user.findUnique({
      where: { email: req.email }
    });

    if (!userToAdd) {
      throw encore.createError({
        statusCode: 404,
        message: 'User not found'
      });
    }

    // Check if user is already in the organization
    const existingUserOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: userToAdd.id,
          organizationId: req.id
        }
      }
    });

    if (existingUserOrg) {
      // Update role if already exists
      await prisma.userOrg.update({
        where: {
          userId_organizationId: {
            userId: userToAdd.id,
            organizationId: req.id
          }
        },
        data: { role: req.role }
      });
    } else {
      // Add user to organization
      await prisma.userOrg.create({
        data: {
          userId: userToAdd.id,
          organizationId: req.id,
          role: req.role
        }
      });
    }

    return { success: true };
  }
});

/**
 * Remove a user from an organization
 */
api.endpoint('removeUserFromOrganization', {
  method: 'DELETE',
  path: '/organizations/:orgId/users/:userId',
  middleware: [requireRole('USER')],
  handler: async (req: { orgId: string, userId: string }, context: any): Promise<any> => {
    // Check if user has admin access to this organization
    const userOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: context.user.userId,
          organizationId: req.orgId
        }
      }
    });

    if (!userOrg || (userOrg.role !== 'OWNER' && userOrg.role !== 'ADMIN')) {
      throw encore.createError({
        statusCode: 403,
        message: 'You do not have permission to remove users from this organization'
      });
    }

    // Prevent removing the last owner
    if (req.userId !== context.user.userId) {
      const targetUserOrg = await prisma.userOrg.findUnique({
        where: {
          userId_organizationId: {
            userId: req.userId,
            organizationId: req.orgId
          }
        }
      });

      if (targetUserOrg?.role === 'OWNER') {
        // Count how many owners are left
        const ownerCount = await prisma.userOrg.count({
          where: {
            organizationId: req.orgId,
            role: 'OWNER'
          }
        });

        if (ownerCount <= 1) {
          throw encore.createError({
            statusCode: 400,
            message: 'Cannot remove the last owner from the organization'
          });
        }
      }
    }

    // Remove user from organization
    await prisma.userOrg.delete({
      where: {
        userId_organizationId: {
          userId: req.userId,
          organizationId: req.orgId
        }
      }
    });

    return { success: true };
  }
});

export default api; 