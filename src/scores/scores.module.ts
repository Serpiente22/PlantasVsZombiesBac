import { Module } from '@nestjs/common';
import { ScoresService } from './scores.service';

@Module({
  providers: [ScoresService]
})
export class ScoresModule {}
