// @ts-ignore - Bỏ qua lỗi TypeScript cho import Prisma
import client from '@prisma/client'

// @ts-ignore - Truy cập PrismaClient động
const PrismaClient = client?.PrismaClient || client

// Tạo singleton instance
let prisma: any

// Trong môi trường development, sử dụng biến global để tránh nhiều instances
if (process.env.NODE_ENV !== 'production') {
  if (!(global as any).prisma) {
    (global as any).prisma = new PrismaClient()
  }
  prisma = (global as any).prisma
} else {
  // Trong production, tạo instance mới
  prisma = new PrismaClient()
}

export default prisma 