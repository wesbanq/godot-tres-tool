import JSON5 from 'json5';
import { z } from 'zod';
import {
  coreValidationMessages,
  createIssue,
  createIssueFromCoreValidationMessage,
  ErrorCode,
  type Issue,
  IssueSeverity,
  formatZodError,
  zodParseErrorMessage,
} from './errors';

/** Literal values accepted in `[...]` header type position (single source for Zod + sets). */
export const RESOURCE_TYPE_VALUES = ['resource', 'sub_resource', 'ext_resource', 'gd_resource'] as const;

/** Bracket header kind in a `.tres` file (`gd_resource`, `ext_resource`, etc.). */
export const resourceTypeSchema = z.enum(RESOURCE_TYPE_VALUES);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

/** Any string property literal (Godot RHS text, including quoted segments stripped by the parser). */
export const propertyStringSchema = z.string();
export type PropertyString = z.infer<typeof propertyStringSchema>;

export const propertyNumberSchema = z.number();
export type PropertyNumber = z.infer<typeof propertyNumberSchema>;

export const propertyBooleanSchema = z.boolean();
export type PropertyBoolean = z.infer<typeof propertyBooleanSchema>;

export const propertyNullSchema = z.null();
export type PropertyNull = z.infer<typeof propertyNullSchema>;

/** Project path reference (`res://...`). */
export const propertyResSchema = z.string().startsWith('res://');
export type PropertyRes = z.infer<typeof propertyResSchema>;

/** Godot unique-id reference (`uid://...`). */
export const propertyUidSchema = z.string().startsWith('uid://');
export type PropertyUid = z.infer<typeof propertyUidSchema>;

/** In-file resource id (`id://...`). */
export const propertyIdSchema = z.string().startsWith('id://');
export type PropertyId = z.infer<typeof propertyIdSchema>;

/** `ExtResource("id")` constructor text as stored after parsing or in JSON. */
export const propertyExtResourceSchema = z.string().regex(/^ExtResource\s*\(/i);
export type PropertyExtResource = z.infer<typeof propertyExtResourceSchema>;

/** `SubResource("id")` constructor text as stored after parsing or in JSON. */
export const propertySubResourceSchema = z.string().regex(/^SubResource\s*\(/i);
export type PropertySubResource = z.infer<typeof propertySubResourceSchema>;

/** Non-recursive property atoms (everything except structured `Array[...]([...])` JSON). */
export const propertyValueBaseSchema = z.union([
  propertyNullSchema,
  propertyBooleanSchema,
  propertyNumberSchema,
  propertyResSchema,
  propertyUidSchema,
  propertyIdSchema,
  propertyExtResourceSchema,
  propertySubResourceSchema,
  propertyStringSchema,
]);

/** Structured typed array (JSON); serializes to Godot `Array[type]([...])`. Recursive via {@link PropertyValue}. */
export interface PropertyArray {
  type: PropertyValue;
  items: PropertyValue[];
}

/**
 * JSON / in-memory value for a resource property line. Leaf variants match
 * {@link propertyValueBaseSchema}; the array branch is recursive (TypeScript cannot infer a
 * mutually recursive `z.lazy` pair without `any`, so the schema is annotated with this type).
 */
export type PropertyValue = z.infer<typeof propertyValueBaseSchema> | PropertyArray;

/** Full property value schema (recursive). */
export const propertyValueSchema: z.ZodType<PropertyValue> = z.lazy(() =>
  z.union([
    propertyValueBaseSchema,
    z.object({
      type: z.lazy(() => propertyValueSchema),
      items: z.array(z.lazy(() => propertyValueSchema)),
    }),
  ])
);

/**
 * Godot root `format=` on `gd_resource`: integer in range 1–3.
 * Accepts the modifier string or number as stored on {@link ResourceTypeModifier}.
 */
export const godotResourceFormatSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'string' ? parseInt(v, 10) : v))
  .pipe(
    z.number().refine(
      (n) => Number.isInteger(n) && n >= 1 && n <= 3,
      'Invalid format value in gd_resource header (expected integer 1–3).'
    )
  );

/** `name=value` pair inside a `[...]` header (e.g. `path=`, `type=`, `format=`). */
export const resourceTypeModifierSchema = z.object({
  name: z.string().min(1, 'Resource type modifier name is empty.'),
  value: z.string().min(1, 'Resource type modifier value is empty.'),
});
export type ResourceTypeModifierJSON = z.infer<typeof resourceTypeModifierSchema>;

/** One `key = value` line under a resource block; `value` mirrors JSON/Godot (primitives or nested structures). */
export const resourcePropertySchema = z.object({
  name: z.string().min(1, 'Resource property name is empty.'),
  value: propertyValueSchema,
});
export type ResourcePropertyJSON = z.infer<typeof resourcePropertySchema>;

/** The `[type ...]` line for a single resource section. */
export const resourceHeaderSchema = z.object({
  type: resourceTypeSchema,
  modifiers: z.array(resourceTypeModifierSchema),
});
export type ResourceHeaderJSON = z.infer<typeof resourceHeaderSchema>;

/** Header plus property lines for one `sub_resource` / `ext_resource` / inner `resource` block. */
export const resourceSchema = z.object({
  header: resourceHeaderSchema,
  properties: z.array(resourcePropertySchema),
});
export type ResourceJSON = z.infer<typeof resourceSchema>;

/** Shape produced by {@link ResourceFile.toJSON} / accepted by {@link ResourceFile.fromJSON}. */
export const resourceFileSchema = z.object({
  header: resourceHeaderSchema,
  resources: z.array(resourceSchema),
});
export type ResourceFileJSON = z.infer<typeof resourceFileSchema>;

/** Model types that can validate and hydrate from JSON; `.tres` text via the serializer module (`SerializerResult`). */
export interface Serializable {
  /** Schema and shape checks; empty array means no problems. Intended for the analyzer (or explicit checks)—not for serialization. */
  validate(): Issue[];
  fromJSON(raw: string | unknown): Serializable;
}

function parseJson(raw: string | unknown): unknown {
  return typeof raw === 'string' ? JSON5.parse(raw) : raw;
}

function resourceFromParsed(data: ResourceJSON): Resource {
  return new Resource(
    new ResourceHeader(
      data.header.type,
      data.header.modifiers.map((m) => new ResourceTypeModifier(m.name, m.value))
    ),
    data.properties.map((p) => new ResourceProperty(p.name, p.value))
  );
}

/** `name=value` pair inside a `[...]` header (e.g. `path=`, `type=`, `format=`). */
export class ResourceTypeModifier implements Serializable {
  name: string;
  value: string;

  constructor(name: string, value: string) {
    this.name = name;
    this.value = value;
  }

  static fromJSON(raw: string | unknown): ResourceTypeModifier {
    const parsed = resourceTypeModifierSchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      throw new Error(`Invalid ResourceTypeModifier in JSON. ${formatZodError(parsed.error)}`);
    }
    const { name, value } = parsed.data;
    return new ResourceTypeModifier(name, value);
  }

  fromJSON(raw: string | unknown): Serializable {
    return ResourceTypeModifier.fromJSON(raw);
  }

  validate(): Issue[] {
    const r = resourceTypeModifierSchema.safeParse({ name: this.name, value: this.value });
    if (!r.success) {
      return [createIssue(ErrorCode.SchemaValidationFailed, formatZodError(r.error as z.ZodError))];
    }
    return [];
  }
}

/** One `key = value` line under a resource block; `value` mirrors JSON/Godot (primitives or nested structures). */
export class ResourceProperty implements Serializable {
  name: string;
  value: PropertyValue;

  constructor(name: string, value: PropertyValue) {
    this.name = name;
    this.value = value;
  }

  static fromJSON(raw: string | unknown): ResourceProperty {
    const parsed = resourcePropertySchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      throw new Error(`Invalid ResourceProperty in JSON. ${zodParseErrorMessage(parsed.error)}`);
    }
    const { name, value } = parsed.data;
    return new ResourceProperty(name, value);
  }

  fromJSON(raw: string | unknown): Serializable {
    return ResourceProperty.fromJSON(raw);
  }

  validate(): Issue[] {
    const r = resourcePropertySchema.safeParse({ name: this.name, value: this.value });
    if (!r.success) {
      return [createIssue(ErrorCode.SchemaValidationFailed, formatZodError(r.error))];
    }
    return [];
  }
}

/** The `[type ...]` line for a single resource section. */
export class ResourceHeader implements Serializable {
  type: ResourceType;
  modifiers: ResourceTypeModifier[];

  constructor(type: ResourceType, modifiers: ResourceTypeModifier[]) {
    this.type = type;
    this.modifiers = modifiers;
  }

  static fromJSON(raw: string | unknown): ResourceHeader {
    const parsed = resourceHeaderSchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      throw new Error(`Invalid ResourceHeader in JSON. ${zodParseErrorMessage(parsed.error)}`);
    }
    const { type, modifiers } = parsed.data;
    return new ResourceHeader(
      type,
      modifiers.map((m) => new ResourceTypeModifier(m.name, m.value))
    );
  }

  fromJSON(raw: string | unknown): Serializable {
    return ResourceHeader.fromJSON(raw);
  }

  getModifier(name: string): ResourceTypeModifier | undefined {
    return this.modifiers.find((modifier) => modifier.name === name);
  }

  addModifier(modifier: ResourceTypeModifier): void {
    this.modifiers.push(modifier);
  }

  validate(): Issue[] {
    const issues: Issue[] = [];
    if (this.type === undefined) {
      issues.push(createIssue(ErrorCode.ResourceHeaderTypeEmpty));
    } else {
      if (this.type.length === 0) {
        issues.push(createIssue(ErrorCode.ResourceHeaderTypeEmpty));
      } else if (!resourceTypeSchema.safeParse(this.type).success) {
        issues.push(createIssue(ErrorCode.UnknownResourceHeaderType, this.type));
      }
    }
    for (const mod of this.modifiers) {
      issues.push(...mod.validate());
    }
    return issues;
  }
}

/** Header plus property lines for one `sub_resource` / `ext_resource` / inner `resource` block. */
export class Resource implements Serializable {
  header: ResourceHeader;
  properties: ResourceProperty[];

  constructor(header: ResourceHeader, properties: ResourceProperty[]) {
    this.header = header;
    this.properties = properties;
  }

  static fromJSON(raw: string | unknown): Resource {
    const parsed = resourceSchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      throw new Error(`Invalid Resource in JSON. ${zodParseErrorMessage(parsed.error)}`);
    }
    return resourceFromParsed(parsed.data);
  }

  fromJSON(raw: string | unknown): Serializable {
    return Resource.fromJSON(raw);
  }

  addProperty(property: ResourceProperty): void {
    this.properties.push(property);
  }

  getProperty(name: string): ResourceProperty | undefined {
    return this.properties.find((property) => property.name === name);
  }

  validate(): Issue[] {
    return [...this.header.validate(), ...this.properties.flatMap((property) => property.validate())];
  }
}

/** Whole `.tres` document: leading `gd_resource` header plus ordered resource blocks. */
export class ResourceFile implements Serializable {
  header: ResourceHeader;
  resources: Resource[];

  constructor(header: ResourceHeader, resources: Resource[]) {
    this.header = header;
    this.resources = resources;
  }

  /**
   * Assemble a file parsed from `.tres` text. Call {@link ResourceFile.validate} or the analyzer before relying on invariants.
   */
  static fromParsedTres(header: ResourceHeader, resources: Resource[]): ResourceFile {
    return new ResourceFile(header, resources);
  }

  /**
   * Builds a ResourceFile from JSON produced by {@link ResourceFile.toJSON} (string or parsed object).
   */
  static fromJSON(raw: string | unknown): ResourceFile {
    const { errors, file } = ResourceFile.fromJSONWithErrors(raw);
    if (errors.length > 0) {
      throw new Error(errors[0]);
    }
    return file!;
  }

  /**
   * Like {@link ResourceFile.fromJSON} but records every top-level and resource-level failure
   * instead of stopping at the first.
   */
  static fromJSONWithErrors(raw: string | unknown): { errors: string[]; file?: ResourceFile } {
    const errors: string[] = [];
    let data: unknown;
    try {
      data = parseJson(raw);
    } catch (e) {
      return { errors: [(e as Error).message] };
    }

    const top = z
      .object({
        header: z.unknown(),
        resources: z.array(z.unknown()),
      })
      .safeParse(data);

    if (!top.success) {
      errors.push('Invalid ResourceFile JSON: expected object with header and resources.');
      return { errors };
    }

    const { header, resources } = top.data;

    let rh: ResourceHeader | undefined;
    const hr = resourceHeaderSchema.safeParse(header);
    if (!hr.success) {
      errors.push(`header: ${zodParseErrorMessage(hr.error)}`);
    } else {
      rh = new ResourceHeader(
        hr.data.type,
        hr.data.modifiers.map((m) => new ResourceTypeModifier(m.name, m.value))
      );
    }

    const resList: Resource[] = [];
    resources.forEach((r, i) => {
      const rr = resourceSchema.safeParse(r);
      if (!rr.success) {
        errors.push(`resources[${i}]: ${zodParseErrorMessage(rr.error)}`);
      } else {
        resList.push(resourceFromParsed(rr.data));
      }
    });

    if (errors.length > 0) {
      return { errors };
    }

    const file = new ResourceFile(rh!, resList);
    const valIssues = file.validate().filter((i) => i.severity === IssueSeverity.Error);
    if (valIssues.length > 0) {
      return { errors: valIssues.map((i) => i.message) };
    }

    return { file, errors: [] };
  }

  fromJSON(raw: string | unknown): Serializable {
    return ResourceFile.fromJSON(raw);
  }

  insertResource(res: Resource): void {
    this.resources.push(res);
  }

  toJSON(minified: boolean = false): string {
    return JSON5.stringify(
      {
        header: this.header,
        resources: this.resources,
      },
      null,
      minified ? undefined : 2
    );
  }

  /** `format` modifier on the root `gd_resource` (Godot resource format version). */
  godotVersion(): string {
    return this.header.getModifier('format')!.value;
  }

  /**
   * Core document checks used by {@link ResourceFile.validate} (root `format`, non-empty body).
   * `gd_resource` placement is enforced by the analyzer, not here.
   */
  static collectValidationErrors(header: ResourceHeader, resources: Resource[]): string[] {
    const errors: string[] = [];
    if (resources.length === 0) {
      errors.push(coreValidationMessages.noResourcesInFile);
    }
    if (header.modifiers.find((modifier) => modifier.name === 'format') === undefined) {
      errors.push(coreValidationMessages.baseMissingFormatModifier);
    }
    return errors;
  }

  validate(): Issue[] {
    const issues: Issue[] = [];
    for (const msg of ResourceFile.collectValidationErrors(this.header, this.resources)) {
      issues.push(createIssueFromCoreValidationMessage(msg));
    }
    issues.push(...this.header.validate());
    for (const resource of this.resources) {
      issues.push(...resource.validate());
    }
    return issues;
  }
}
