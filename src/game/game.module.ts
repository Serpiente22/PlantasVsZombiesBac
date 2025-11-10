// src/game/game.module.ts
import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { GameGateway } from './game.gateway'; // 👈 IMPORTANTE
import { RoomsModule } from '../rooms/rooms.module';

@Module({
  imports: [RoomsModule],
  providers: [GameService, GameGateway], // 👈 AGREGA EL GATEWAY AQUÍ
})
export class GameModule {}
