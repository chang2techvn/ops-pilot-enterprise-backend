import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { requireRole } from './middleware';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ops-pilot-enterprise-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Register a new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password and name are required' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(409).json({ error: 'User already exists with this email' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'USER' // Default role
      }
    });

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as SignOptions
    );

    // Return user info and token
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login with email/password
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, organizationId } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Prepare token payload
    const tokenPayload: any = {
      userId: user.id,
      email: user.email,
      role: user.role
    };

    const responseUser: any = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    };

    // If organizationId is provided, validate and include it
    if (organizationId) {
      // Check if user is part of this organization
      const userOrg = await prisma.userOrg.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId
          }
        }
      });

      if (userOrg) {
        tokenPayload.organizationId = organizationId;
        tokenPayload.orgRole = userOrg.role;
        responseUser.organizationId = organizationId;
        responseUser.orgRole = userOrg.role;
      }
    }

    // Generate JWT token
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as SignOptions);

    // Return user info and token
    res.json({
      token,
      user: responseUser
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user profile
router.get('/me', async (req: Request, res: Response) => {
  try {
    if (!req.context?.user?.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get user from database with fresh data
    const user = await prisma.user.findUnique({
      where: { id: req.context.user.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizations: {
          include: {
            organization: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create response
    const response = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizations: user.organizations.map((o: any) => ({
        id: o.organization.id,
        name: o.organization.name,
        role: o.role
      }))
    };

    // If there's an org context in the token, include it
    if (req.context?.user?.organizationId) {
      const currentOrg = user.organizations.find(
        (o: any) => o.organization.id === req.context?.user?.organizationId
      )?.organization;

      if (currentOrg) {
        (response as any).currentOrganization = currentOrg;
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Switch organization context
router.post('/switch-organization', async (req: Request, res: Response) => {
  try {
    if (!req.context?.user?.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { organizationId } = req.body;

    // Check if organization ID is provided
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID is required' });
    }

    // Check if user is part of this organization
    const userOrg = await prisma.userOrg.findUnique({
      where: {
        userId_organizationId: {
          userId: req.context.user.userId,
          organizationId
        }
      },
      include: {
        organization: true
      }
    });

    if (!userOrg) {
      return res.status(403).json({ error: 'You do not have access to this organization' });
    }

    // Create token with organization context
    const tokenPayload = {
      userId: req.context.user.userId,
      email: req.context.user.email,
      role: req.context.user.role,
      organizationId,
      orgRole: userOrg.role
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as SignOptions);

    // Return new token and organization info
    res.json({
      token,
      organization: {
        id: userOrg.organization.id,
        name: userOrg.organization.name,
        role: userOrg.role
      }
    });
  } catch (error) {
    console.error('Error switching organization:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 