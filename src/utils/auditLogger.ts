import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';

/**
 * Log an action to the audit log
 * @param userId - ID of the user performing the action
 * @param action - Type of action (CREATE, UPDATE, DELETE)
 * @param entityType - Type of entity being modified (Task, Project, etc.)
 * @param entityId - ID of the entity being modified
 * @param details - Additional details (previous values, new values, etc.)
 */
export async function logAction(
  userId: string,
  action: 'CREATE' | 'UPDATE' | 'DELETE',
  entityType: string,
  entityId: string,
  details: any
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entityType,
        entityId,
        details,
        createdAt: new Date()
      }
    });
  } catch (error) {
    console.error('Error logging audit action:', error);
    // We don't throw or return the error to avoid disrupting the main operation
  }
}

/**
 * Helper to extract userId from request context
 */
export function getUserIdFromRequest(req: Request): string | null {
  return req.context?.user?.userId || null;
}

/**
 * Middleware that attaches audit logging functions to the request
 * This simplifies audit logging in route handlers
 */
export function auditAPIAction(entityType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json;
    const userId = getUserIdFromRequest(req);

    // Enhance response.json to log actions based on HTTP method
    res.json = function(body) {
      const entityId = body?.id || req.params?.id;
      
      if (userId && entityId) {
        let action: 'CREATE' | 'UPDATE' | 'DELETE';
        
        switch (req.method) {
          case 'POST':
            action = 'CREATE';
            logAction(userId, action, entityType, entityId, { newData: body });
            break;
          case 'PUT':
          case 'PATCH':
            action = 'UPDATE';
            logAction(userId, action, entityType, entityId, { 
              updatedData: body,
              updatedBy: req.context?.user?.email || userId
            });
            break;
          case 'DELETE':
            action = 'DELETE';
            logAction(userId, action, entityType, entityId, { 
              message: 'Entity deleted',
              deletedBy: req.context?.user?.email || userId
            });
            break;
        }
      }
      
      // Call the original json method
      return originalJson.call(this, body);
    };
    
    next();
  };
}