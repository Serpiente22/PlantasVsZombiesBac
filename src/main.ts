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
          'http://localhost:3000',               // Desarrollo local
          'http://localhost:3001',               // Desarrollo local (puerto alternativo)
          'https://pvz-frontend.onrender.com',   // Tu frontend anterior (por si acaso)
          'https://juego-font-zdth.vercel.app',  // 👈 NUEVO: Tu despliegue actual de Vercel
          'https://juego-font.vercel.app',       // 👈 NUEVO: Tu dominio principal de Vercel
        ],
        credentials: true,
      },
      transports: ['websocket'],
    };
    return super.createIOServer(port, opts as ServerOptions);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Permitir CORS explícitamente para peticiones HTTP normales
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://pvz-frontend.onrender.com',
      'https://juego-font-zdth.vercel.app', // 👈 Agregado aquí también
      'https://juego-font.vercel.app',      // 👈 Agregado aquí también
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