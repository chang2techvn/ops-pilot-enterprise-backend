import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'ops-pilot-enterprise-secret';

// Context extension for Express Request
declare global {
  namespace Express {
    interface Request {
      context?: {
        user?: {
          userId: string;
          email: string;
          role: string;
          organizationId?: string;
          orgRole?: string;
        };
      };
    }
  }
}

// Middleware to authenticate JWT and add user to request
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Skip auth for login and register endpoints
    if (req.path === '/auth/login' || req.path === '/auth/register') {
      return next();
    }

    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return next(); // No token provided, proceed but as unauthenticated
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      // Add user and context to request
      req.context = {
        user: {
          userId: decoded.userId,
          email: decoded.email,
          role: decoded.role,
          organizationId: decoded.organizationId,
          orgRole: decoded.orgRole
        }
      };
    } catch (error) {
      // Invalid token, proceed as unauthenticated
      console.warn('Invalid token provided:', error);
    }
    
    next();
  } catch (error) {
    console.error('Error in auth middleware:', error);
    next();
  }
};

// Role-based authorization middleware
export const requireRole = (role: string, requireOrgContext = false) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Check if user is authenticated
    if (!req.context?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // For admin role, always allow access
    if (req.context.user.role === 'ADMIN') {
      return next();
    }
    
    // Check if the user has the required role
    if (req.context.user.role !== role) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    // Check if organization context is required
    if (requireOrgContext && !req.context.user.organizationId) {
      return res.status(400).json({ 
        error: 'Organization context required',
        code: 'ORGANIZATION_REQUIRED'
      });
    }
    
    next();
  };
}; 