import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

class CustomIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions) {
    const opts: Partial<ServerOptions> = {
      ...(options ?? {}),
      cors: {
        origin: [
          'http://localhost:3000', // 👈 para desarrollo local
          'http://localhost:3001', // 👈 si usas ese puerto
          'https://pvz-frontend.onrender.com', // 👈 si luego lo subes a Render
        ],
        credentials: true, // 👈 importante para evitar el error CORS
      },
      transports: ['websocket'], // 👈 solo WebSocket (sin polling)
    };
    return super.createIOServer(port, opts as ServerOptions);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Permitir CORS explícitamente
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://pvz-frontend.onrender.com',
    ],
    credentials: true,
  });

  // Adaptador de socket personalizado
  app.useWebSocketAdapter(new CustomIoAdapter(app));

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`✅ Servidor corriendo en puerto ${port}`);
}

bootstrap();
