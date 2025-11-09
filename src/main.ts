import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Permite conexiones desde cualquier origen
  app.enableCors({ origin: '*' });

  // Necesario para que Socket.IO funcione correctamente
  app.useWebSocketAdapter(new IoAdapter(app));

  // Escucha en el puerto de Render y en todas las interfaces
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Servidor escuchando en puerto ${port}`);
}

bootstrap();
