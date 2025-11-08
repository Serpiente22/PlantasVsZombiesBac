import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';

@Module({
  providers: [RoomsService],
  exports: [RoomsService], // 👈 AGREGA ESTA LÍNEA
})
export class RoomsModule {}
