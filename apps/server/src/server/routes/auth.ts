import type { AppContext, AppInstance } from "@/server/types";

interface LoginBody {
  username: string;
  password: string;
}

interface JwtPayload {
  username: string;
  iat: number;
  exp: number;
}

/**
 * Authentication routes
 */
export async function authRoutes(
  app: AppInstance,
  context: AppContext
): Promise<void> {
  // Login endpoint
  app.post<{ Body: LoginBody }>("/login", async (request, reply) => {
    const { username, password } = request.body;

    // Validate credentials
    if (!username || !password) {
      return reply.code(400).send({
        error: "Username and password are required",
      });
    }

    // Check if auth is disabled (no password configured)
    if (!context.config.auth.password) {
      return reply.code(401).send({
        error: "Authentication is not configured. Set WAN_MONITOR_PASSWORD.",
      });
    }

    // Verify credentials
    if (
      username !== context.config.auth.username ||
      password !== context.config.auth.password
    ) {
      return reply.code(401).send({
        error: "Invalid username or password",
      });
    }

    // Generate JWT token
    const token = app.jwt.sign(
      { username },
      { expiresIn: context.config.auth.jwtExpiresIn }
    );

    // Calculate expiration time
    const decoded = app.jwt.decode<JwtPayload>(token);
    const expiresAt = decoded?.exp
      ? new Date(decoded.exp * 1000).toISOString()
      : null;

    return reply.code(200).send({
      token,
      expiresAt,
      username,
    });
  });

  // Logout endpoint (client-side token removal, but we can track it server-side if needed)
  app.post("/logout", async (_request, reply) => {
    return reply.code(200).send({
      success: true,
      message: "Logged out successfully",
    });
  });

  // Get current user info (authentication handled by global hook in app.ts)
  app.get("/me", async (request, reply) => {
    const user = request.user as JwtPayload;
    return reply.code(200).send({
      username: user.username,
      authenticated: true,
    });
  });

  // Check if auth is required (public endpoint)
  app.get("/status", async (_request, reply) => {
    const authRequired = Boolean(context.config.auth.password);
    return reply.code(200).send({
      authRequired,
    });
  });
}
