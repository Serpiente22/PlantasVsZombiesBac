import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RoomsModule } from './rooms/rooms.module';
import { GameModule } from './game/game.module';
import { ScoresModule } from './scores/scores.module';

@Module({
  imports: [RoomsModule, GameModule, ScoresModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
