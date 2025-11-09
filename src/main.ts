// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

class CustomIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions) {
    const opts: Partial<ServerOptions> = {
      ...(options ?? {}),
      cors: {
        origin: '*', // Permitir cualquier origen (frontend)
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['polling', 'websocket'], // ✅ Soporte para Render
    };
    return super.createIOServer(port, opts as ServerOptions);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Permitir CORS globalmente
  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  });

  // Adaptador Socket.IO personalizado
  app.useWebSocketAdapter(new CustomIoAdapter(app));

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Servidor corriendo en puerto ${port}`);
}

bootstrap();
