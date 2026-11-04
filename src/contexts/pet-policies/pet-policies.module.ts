import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { UnitPetPolicyEntity } from "./entities/unit-pet-policy.entity";
import { UnitPetPolicyZoneEntity } from "./entities/unit-pet-policy-zone.entity";

// Entity registration only (no controllers): lets TypeORM autoLoadEntities
// resolve string-based relations (e.g. RoomEntity -> "SiteUnitEntity").
@Module({
  imports: [
    TypeOrmModule.forFeature([UnitPetPolicyEntity, UnitPetPolicyZoneEntity]),
  ],
  exports: [TypeOrmModule],
})
export class PetPoliciesModule {}
