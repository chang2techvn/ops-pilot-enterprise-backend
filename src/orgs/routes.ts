import express, { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireRole } from '../auth/middleware';

const router = express.Router();

// Create a new organization
router.post('/', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    // Check if user is authenticated
    if (!req.context?.user?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { name, description } = req.body;

    // Validate input
    if (!name) {
      return res.status(400).json({ error: 'Organization name is required' });
    }

    // Create organization and add current user as owner in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Create the organization
      const org = await tx.organization.create({
        data: {
          name,
          description
        }
      });

      // Add the current user as owner
      await tx.userOrg.create({
        data: {
          userId: req.context!.user!.userId,
          organizationId: org.id,
          role: 'OWNER'
        }
      });

      return org;
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all organizations the current user is a member of
router.get('/', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    // Check if user is authenticated
    if (!req.context?.user?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's organizations
    const userOrgs = await prisma.userOrg.findMany({
      where: { userId: req.context.user.userId },
      include: {
        organization: true
      }
    });

    const formattedOrgs = userOrgs.map((uo: any) => ({
      id: uo.organization.id,
      name: uo.organization.name,
      description: uo.organization.description,
      role: uo.role,
      createdAt: uo.organization.createdAt
    }));

    res.json(formattedOrgs);
  } catch (error) {
    console.error('Error getting organizations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a specific organization
router.get('/:id', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    // Check if user is authenticated
    if (!req.context?.user?.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;

    // Check if user has access to this organization
    const userOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: req.context.user.userId,
          organizationId: id
        }
      }
    });

    if (!userOrg) {
      return res.status(403).json({ error: 'You do not have access to this organization' });
    }

    // Get organization
    const org = await prisma.organization.findUnique({
      where: { id },
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
      return res.status(404).json({ error: 'Organization not found' });
    }

    const response = {
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

    res.json(response);
  } catch (error) {
    console.error('Error getting organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update an organization
router.patch('/:id', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    // Check if user has access to this organization
    const userOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: req.context!.user!.userId,
          organizationId: id
        }
      }
    });

    if (!userOrg || (userOrg.role !== 'OWNER' && userOrg.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'You do not have permission to update this organization' });
    }

    // Update organization
    const org = await prisma.organization.update({
      where: { id },
      data: {
        name,
        description
      }
    });

    res.json(org);
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a user to an organization
router.post('/:id/users', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { email, role } = req.body;

    if (!email || !role || !['OWNER', 'ADMIN', 'MEMBER'].includes(role)) {
      return res.status(400).json({ error: 'Email and valid role are required' });
    }

    // Check if user has admin access to this organization
    const userOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: req.context!.user!.userId,
          organizationId: id
        }
      }
    });

    if (!userOrg || (userOrg.role !== 'OWNER' && userOrg.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'You do not have permission to add users to this organization' });
    }

    // Find user by email
    const userToAdd = await prisma.user.findUnique({
      where: { email }
    });

    if (!userToAdd) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user is already in the organization
    const existingUserOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: userToAdd.id,
          organizationId: id
        }
      }
    });

    if (existingUserOrg) {
      // Update role if already exists
      await prisma.userOrg.update({
        where: {
          userId_organizationId: {
            userId: userToAdd.id,
            organizationId: id
          }
        },
        data: { role }
      });
    } else {
      // Add user to organization
      await prisma.userOrg.create({
        data: {
          userId: userToAdd.id,
          organizationId: id,
          role
        }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error adding user to organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove a user from an organization
router.delete('/:orgId/users/:userId', requireRole('USER'), async (req: Request, res: Response) => {
  try {
    const { orgId, userId } = req.params;

    // Check if user has admin access to this organization
    const userOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: req.context!.user!.userId,
          organizationId: orgId
        }
      }
    });

    if (!userOrg || (userOrg.role !== 'OWNER' && userOrg.role !== 'ADMIN')) {
      return res.status(403).json({ error: 'You do not have permission to remove users from this organization' });
    }

    // Prevent removing the last owner
    if (userId !== req.context!.user!.userId) {
      const targetUserOrg = await prisma.userOrg.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId: orgId
          }
        }
      });

      if (targetUserOrg?.role === 'OWNER') {
        // Count how many owners are left
        const ownerCount = await prisma.userOrg.count({
          where: {
            organizationId: orgId,
            role: 'OWNER'
          }
        });

        if (ownerCount <= 1) {
          return res.status(400).json({ error: 'Cannot remove the last owner from the organization' });
        }
      }
    }

    // Remove user from organization
    await prisma.userOrg.delete({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId
        }
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing user from organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 