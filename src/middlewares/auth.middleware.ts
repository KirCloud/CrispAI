import { adminAuth } from "@/services/admin-auth.service";

export const authMiddleware = adminAuth.middleware;
