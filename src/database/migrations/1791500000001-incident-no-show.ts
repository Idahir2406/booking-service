import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Punto 6 del contrato (no-show): the host reports
// "No se presentó", which opens an incident of the new type `no_show` (never
// offered to the traveler) reviewed by V4P in admino.
// 1. reservation_incidents.type enum gains 'no_show'.
// 2. Traveler panel label (página 'cuenta_viajero', same keys as cv_inc_type_*).
// down: removes the text and restores the enum (fails while no_show rows exist,
// on purpose: they must be resolved/migrated by hand first).
const CUSTOMER = 'v4p';
const PAGE = 'cuenta_viajero';

const ENUM_WITH_NO_SHOW =
    "'before_arrival','during_stay','dog_issue','conditions_not_respected','charge_issue','refund_issue','force_majeure_cancellation','no_show','other'";
const ENUM_WITHOUT_NO_SHOW =
    "'before_arrival','during_stay','dog_issue','conditions_not_respected','charge_issue','refund_issue','force_majeure_cancellation','other'";

const VARIABLES: readonly (readonly [string, string])[] = [
    ['cv_inc_type_no_show', 'No presentación indicada por el alojamiento'],
];

export class IncidentNoShow1791500000001 implements MigrationInterface {
    name = 'IncidentNoShow1791500000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE \`reservation_incidents\` MODIFY \`type\` enum(${ENUM_WITH_NO_SHOW}) NOT NULL`,
        );

        const pageId = await this.findPageId(queryRunner);
        if (pageId === undefined) {
            // Page is created by the incidents seeds; PHP/JS keep Spanish fallbacks.
            return;
        }
        const existing = await queryRunner.query(
            `SELECT \`variable\`, \`sequence\` FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ?`,
            [CUSTOMER, String(pageId)],
        ) as { variable: string; sequence: number | null }[];
        const existingKeys = new Set(existing.map(row => row.variable));
        let sequence = Math.max(0, ...existing.map(row => Number(row.sequence ?? 0)));
        for (const [variable, text] of VARIABLES) {
            if (existingKeys.has(variable)) {
                continue;
            }
            sequence += 10;
            await queryRunner.query(
                `INSERT INTO \`v4p_jvariables1\` (\`customer\`, \`idback\`, \`sequence\`, \`variable\`, \`description_l1\`, \`link\`) VALUES (?, ?, ?, ?, ?, '')`,
                [CUSTOMER, String(pageId), sequence, variable, text],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const pageId = await this.findPageId(queryRunner);
        if (pageId !== undefined) {
            await queryRunner.query(
                `DELETE FROM \`v4p_jvariables1\` WHERE \`customer\` = ? AND \`idback\` = ? AND \`variable\` IN (?)`,
                [CUSTOMER, String(pageId), VARIABLES.map(([variable]) => variable)],
            );
        }
        await queryRunner.query(
            `ALTER TABLE \`reservation_incidents\` MODIFY \`type\` enum(${ENUM_WITHOUT_NO_SHOW}) NOT NULL`,
        );
    }

    private async findPageId(queryRunner: QueryRunner): Promise<number | undefined> {
        const rows = await queryRunner.query(
            `SELECT \`id\` FROM \`v4p_jvariables0\` WHERE \`customer\` = ? AND \`pagina\` = ? ORDER BY \`id\` LIMIT 1`,
            [CUSTOMER, PAGE],
        ) as { id: number }[];
        const [first] = rows as ({ id: number } | undefined)[];
        return first === undefined ? undefined : Number(first.id);
    }
}
