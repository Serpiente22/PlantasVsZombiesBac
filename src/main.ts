import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Habilita CORS (para que tu frontend en Vercel pueda conectarse)
  app.enableCors({
    origin: '*',
  });

  // Render necesita escuchar en 0.0.0.0
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
