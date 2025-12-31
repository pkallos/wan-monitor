import cors from '@fastify/cors';
import Fastify from 'fastify';

export const createApp = () => {
  const app = Fastify({
    logger: {
      level: 'info',
    },
  });

  // Register CORS
  app.register(cors, {
    origin: true,
  });

  return app;
};
