import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { RoomsModule } from '../rooms/rooms.module'; // 👈 importante

@Module({
  imports: [RoomsModule], // 👈 esto arregla el error
  providers: [GameService]
})
export class GameModule {}
