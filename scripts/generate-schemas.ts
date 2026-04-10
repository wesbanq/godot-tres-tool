import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { 
    propertyValueSchema,
    resourcePropertySchema,
    resourceSchema,
    resourceFileSchema,
    resourceHeaderSchema,
    resourceTypeModifierSchema,
    resourceTypeSchema,
} from '../src/tres-types';

const outPath = path.join(__dirname, '..', 'schemas');

const propertyValueSchemaJson = z.toJSONSchema(propertyValueSchema);
const resourcePropertyJsonSchemaJson = z.toJSONSchema(resourcePropertySchema);
const resourceJsonSchemaJson = z.toJSONSchema(resourceSchema);
const resourceFileJsonSchemaJson = z.toJSONSchema(resourceFileSchema);
const resourceHeaderJsonSchemaJson = z.toJSONSchema(resourceHeaderSchema);
const resourceTypeModifierJsonSchemaJson = z.toJSONSchema(resourceTypeModifierSchema);
const resourceTypeSchemaJson = z.toJSONSchema(resourceTypeSchema);

fs.writeFileSync(path.join(outPath, 'propertyValueSchema.json'), JSON.stringify(propertyValueSchemaJson, null, 2));
fs.writeFileSync(path.join(outPath, 'resourcePropertySchema.json'), JSON.stringify(resourcePropertyJsonSchemaJson, null, 2));
fs.writeFileSync(path.join(outPath, 'resourceSchema.json'), JSON.stringify(resourceJsonSchemaJson, null, 2));
fs.writeFileSync(path.join(outPath, 'resourceFileSchema.json'), JSON.stringify(resourceFileJsonSchemaJson, null, 2));
fs.writeFileSync(path.join(outPath, 'resourceHeaderSchema.json'), JSON.stringify(resourceHeaderJsonSchemaJson, null, 2));
fs.writeFileSync(path.join(outPath, 'resourceTypeModifierSchema.json'), JSON.stringify(resourceTypeModifierJsonSchemaJson, null, 2));
fs.writeFileSync(path.join(outPath, 'resourceTypeSchema.json'), JSON.stringify(resourceTypeSchemaJson, null, 2));

console.log('Schemas generated successfully.');