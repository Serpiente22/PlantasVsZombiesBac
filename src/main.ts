import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

class CustomIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: ServerOptions) {
    // Usamos Partial<ServerOptions> para evitar errores de tipo
    const opts: Partial<ServerOptions> = {
      ...(options ?? {}),
      transports: ['websocket'], // 🔹 Solo WebSocket
    };
    return super.createIOServer(port, opts as ServerOptions);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Permite conexiones desde cualquier origen
  app.enableCors({ origin: '*' });

  // Adaptador de Socket.IO personalizado
  app.useWebSocketAdapter(new CustomIoAdapter(app));

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Servidor escuchando en puerto ${port}`);
}

bootstrap();
