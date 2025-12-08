import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RoomsModule } from './rooms/rooms.module';
import { GameModule } from './game/game.module';

@Module({
  imports: [RoomsModule, GameModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
