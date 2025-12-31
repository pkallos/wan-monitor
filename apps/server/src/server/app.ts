import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { loggerConfig } from "@/logger";

export interface AppOptions {
  jwtSecret: string;
  authRequired: boolean;
}

export const createApp = (options: AppOptions) => {
  const app = Fastify({
    logger: loggerConfig,
  });

  // Register CORS
  app.register(cors, {
    origin: true,
  });

  // Register JWT
  app.register(jwt, {
    secret: options.jwtSecret,
  });

  // Add authentication hook for protected routes
  if (options.authRequired) {
    app.addHook("onRequest", async (request, reply) => {
      // Skip auth for public endpoints
      const publicPaths = [
        "/api/auth/login",
        "/api/auth/status",
        "/api/health",
      ];
      if (publicPaths.some((path) => request.url.startsWith(path))) {
        return;
      }

      // Verify JWT for all other /api routes
      if (request.url.startsWith("/api")) {
        try {
          await request.jwtVerify();
        } catch {
          return reply.code(401).send({ error: "Unauthorized" });
        }
      }
    });
  }

  return app;
};
