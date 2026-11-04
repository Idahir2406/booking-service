import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written, idempotent. Wizard step 4 "Servicios" catalogs for species
// "Perro": dog_supplies (amenities + facilities) and additional_services.
// Rows are matched by (species_id, slug): existing slugs are never touched.
// down deletes only these slugs (and the site answers that reference them,
// which cannot exist without this seed).
const SPECIES_NAME = 'Perro';

interface SupplySeed {
    slug: string;
    name: string;
    section: 'amenity' | 'facility';
    score_points: number;
    is_scoring: boolean;
}

interface ServiceSeed {
    slug: string;
    name: string;
}

const amenity = (slug: string, name: string, score_points: number, is_scoring = true): SupplySeed =>
    ({ slug, name, section: 'amenity', score_points, is_scoring });
const facility = (slug: string, name: string): SupplySeed =>
    ({ slug, name, section: 'facility', score_points: 1, is_scoring: true });

const SUPPLIES: readonly SupplySeed[] = [
    amenity('comedero-bebedero', 'Comedero y bebedero', 3),
    amenity('agua-fresca', 'Agua fresca', 3),
    amenity('kit-bienvenida', 'Kit de bienvenida', 3),
    amenity('snacks-bienvenida', 'Snacks de bienvenida', 2),
    amenity('cama-perro', 'Cama para perro', 2),
    amenity('toallas', 'Toallas para perros', 1),
    amenity('ducha-perros', 'Ducha para perros', 1),
    amenity('menu-canino', 'Menú canino', 1),
    amenity('bienestar', 'Servicios de bienestar', 1),
    amenity('secador', 'Secador', 0.5),
    amenity('cumpleanos', 'Celebración de cumpleaños', 0, false),
    facility('jardin-privado', 'Jardín privado'),
    facility('zona-vallada', 'Zona completamente vallada'),
    facility('zona-recreo', 'Zona de recreo canino'),
    facility('pipi-can', 'Pipi-can'),
    facility('pista-agility', 'Pista de agility'),
    facility('parque-acuatico', 'Parque acuático'),
    facility('piscina-perros', 'Piscina para perros'),
];

const SERVICES: readonly ServiceSeed[] = [
    { slug: 'guarderia', name: 'Guardería canina' },
    { slug: 'paseador', name: 'Paseador' },
    { slug: 'dog-sitter', name: 'Dog sitter' },
    { slug: 'adiestramiento', name: 'Adiestramiento' },
];

export class SeedStep4Services1790900000003 implements MigrationInterface {
    name = 'SeedStep4Services1790900000003'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const speciesId = await this.findSpeciesId(queryRunner);
        if (speciesId === undefined) {
            throw new Error(`species "${SPECIES_NAME}" not found`);
        }

        const existingSupplies = await this.existingSlugs(queryRunner, 'dog_supplies', speciesId);
        for (const [index, supply] of SUPPLIES.entries()) {
            if (existingSupplies.has(supply.slug)) {
                continue;
            }
            await queryRunner.query(
                `INSERT INTO \`dog_supplies\`
                   (\`species_id\`, \`name\`, \`slug\`, \`section\`, \`score_points\`, \`is_public\`, \`is_filter\`,
                    \`is_badge\`, \`is_scoring\`, \`completeness_weight\`, \`sort_order\`, \`is_active\`)
                 VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?, 1, ?, 1)`,
                [speciesId, supply.name, supply.slug, supply.section, supply.score_points,
                    supply.is_scoring ? 1 : 0, (index + 1) * 10],
            );
        }

        const existingServices = await this.existingSlugs(queryRunner, 'additional_services', speciesId);
        for (const [index, service] of SERVICES.entries()) {
            if (existingServices.has(service.slug)) {
                continue;
            }
            await queryRunner.query(
                `INSERT INTO \`additional_services\`
                   (\`species_id\`, \`name\`, \`slug\`, \`score_points\`, \`is_public\`, \`is_filter\`, \`sort_order\`, \`is_active\`)
                 VALUES (?, ?, ?, 1, 1, 1, ?, 1)`,
                [speciesId, service.name, service.slug, (index + 1) * 10],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const speciesId = await this.findSpeciesId(queryRunner);
        if (speciesId === undefined) {
            return;
        }
        const supplySlugs = SUPPLIES.map(supply => supply.slug);
        const serviceSlugs = SERVICES.map(service => service.slug);

        await queryRunner.query(
            `DELETE s FROM \`site_dog_supplies\` s
             INNER JOIN \`dog_supplies\` d ON d.\`id\` = s.\`supply_id\`
             WHERE d.\`species_id\` = ? AND d.\`slug\` IN (?)`,
            [speciesId, supplySlugs],
        );
        await queryRunner.query(
            `DELETE FROM \`dog_supplies\` WHERE \`species_id\` = ? AND \`slug\` IN (?)`,
            [speciesId, supplySlugs],
        );
        await queryRunner.query(
            `DELETE s FROM \`site_additional_services\` s
             INNER JOIN \`additional_services\` a ON a.\`id\` = s.\`additional_service_id\`
             WHERE a.\`species_id\` = ? AND a.\`slug\` IN (?)`,
            [speciesId, serviceSlugs],
        );
        await queryRunner.query(
            `DELETE FROM \`additional_services\` WHERE \`species_id\` = ? AND \`slug\` IN (?)`,
            [speciesId, serviceSlugs],
        );
    }

    private async findSpeciesId(queryRunner: QueryRunner): Promise<number | undefined> {
        const rows = await queryRunner.query(
            `SELECT \`id\` FROM \`species\` WHERE \`name\` = ? ORDER BY \`id\` LIMIT 1`,
            [SPECIES_NAME],
        ) as { id: number }[];
        const [first] = rows as ({ id: number } | undefined)[];
        return first === undefined ? undefined : Number(first.id);
    }

    private async existingSlugs(
        queryRunner: QueryRunner,
        table: 'dog_supplies' | 'additional_services',
        speciesId: number,
    ): Promise<Set<string>> {
        const rows = await queryRunner.query(
            `SELECT \`slug\` FROM \`${table}\` WHERE \`species_id\` = ?`,
            [speciesId],
        ) as { slug: string }[];
        return new Set(rows.map(row => row.slug));
    }
}
