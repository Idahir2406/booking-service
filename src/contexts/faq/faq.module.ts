import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { FaqEntity } from "./entities/faq.entity";
import { FaqAnswerEntity } from "./entities/faq-answer.entity";

// Entity registration only (no controllers): lets TypeORM autoLoadEntities
// resolve string-based relations (e.g. RoomEntity -> "SiteUnitEntity").
@Module({
  imports: [TypeOrmModule.forFeature([FaqEntity, FaqAnswerEntity])],
  exports: [TypeOrmModule],
})
export class FaqModule {}
