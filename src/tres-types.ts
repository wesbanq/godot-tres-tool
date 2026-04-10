import { z } from 'zod';
import { coreValidationMessages } from './errors';

/** Literal values accepted in `[...]` header type position (single source for Zod + sets). */
export const RESOURCE_TYPE_VALUES = ['resource', 'sub_resource', 'ext_resource', 'gd_resource'] as const;

/** Bracket header kind in a `.tres` file (`gd_resource`, `ext_resource`, etc.). */
export const resourceTypeSchema = z.enum(RESOURCE_TYPE_VALUES);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

/** Godot unique-id reference (`uid://...`). */
export const resourceUidSchema = z.string().startsWith('uid://');
export type ResourceUid = z.infer<typeof resourceUidSchema>;

/** In-file resource id (`id://...`). */
export const resourceIdSchema = z.string().startsWith('id://');
export type ResourceId = z.infer<typeof resourceIdSchema>;

/** Project path reference (`res://...`). */
export const resourceResSchema = z.string().startsWith('res://');
export type ResourceRes = z.infer<typeof resourceResSchema>;

/** Check if a value is a ResourceRes. */
export function isResourceRes(value: unknown): value is ResourceRes {
  return resourceResSchema.safeParse(value).success;
}

/** Check if a value is a ResourceUid. */
export function isResourceUid(value: unknown): value is ResourceUid {
  return resourceUidSchema.safeParse(value).success;
}

/** Check if a value is a ResourceId. */
export function isResourceId(value: unknown): value is ResourceId {
  return resourceIdSchema.safeParse(value).success;
}

/** Flatten a Zod error into a single human-readable line (paths + messages). */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ` : '') + i.message)
    .join('; ');
}

function zodParseErrorMessage(err: z.ZodError): string {
  return formatZodError(err);
}

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
export const resourceTypeModifierJsonSchema = z.object({
  name: z.string().min(1, 'Resource type modifier name is empty.'),
  value: z.string().min(1, 'Resource type modifier value is empty.'),
});
export type ResourceTypeModifierJSON = z.infer<typeof resourceTypeModifierJsonSchema>;

/** One `key = value` line under a resource block; `value` mirrors JSON/Godot (primitives or nested structures). */
export const resourcePropertyJsonSchema = z.object({
  name: z.string().min(1, 'Resource property name is empty.'),
  value: z.unknown().refine((v) => v !== undefined, {
    message: 'Resource property value is undefined.',
  }),
});
export type ResourcePropertyJSON = z.infer<typeof resourcePropertyJsonSchema>;

/** The `[type ...]` line for a single resource section. */
export const resourceHeaderJsonSchema = z.object({
  type: resourceTypeSchema,
  modifiers: z.array(resourceTypeModifierJsonSchema),
});
export type ResourceHeaderJSON = z.infer<typeof resourceHeaderJsonSchema>;

/** Header plus property lines for one `sub_resource` / `ext_resource` / inner `resource` block. */
export const resourceJsonSchema = z.object({
  header: resourceHeaderJsonSchema,
  properties: z.array(resourcePropertyJsonSchema),
});
export type ResourceJSON = z.infer<typeof resourceJsonSchema>;

/** Shape produced by {@link ResourceFile.toJSON} / accepted by {@link ResourceFile.fromJSON}. */
export const resourceFileJsonSchema = z.object({
  header: resourceHeaderJsonSchema,
  resources: z.array(resourceJsonSchema),
});
export type ResourceFileJSON = z.infer<typeof resourceFileJsonSchema>;

/** Model types that can validate and hydrate from JSON; `.tres` text is produced by `serializer.serializeToTres` / `serializeResourceFile`. */
export interface Serializable {
  validate(): void;
  fromJSON(raw: string | unknown): Serializable;
}

function parseJson(raw: string | unknown): unknown {
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
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
    this.validate();
  }

  static fromJSON(raw: string | unknown): ResourceTypeModifier {
    const parsed = resourceTypeModifierJsonSchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      throw new Error(`Invalid ResourceTypeModifier in JSON. ${zodParseErrorMessage(parsed.error)}`);
    }
    const { name, value } = parsed.data;
    return new ResourceTypeModifier(name, value);
  }

  fromJSON(raw: string | unknown): Serializable {
    return ResourceTypeModifier.fromJSON(raw);
  }

  validate(): void {
    const r = resourceTypeModifierJsonSchema.safeParse({ name: this.name, value: this.value });
    if (!r.success) {
      throw new Error(r.error.issues[0]?.message ?? 'Invalid ResourceTypeModifier.');
    }
  }
}

/** One `key = value` line under a resource block; `value` mirrors JSON/Godot (primitives or nested structures). */
export class ResourceProperty implements Serializable {
  name: string;
  value: any;

  constructor(name: string, value: any) {
    this.name = name;
    this.value = value;
  }

  static fromJSON(raw: string | unknown): ResourceProperty {
    const parsed = resourcePropertyJsonSchema.safeParse(parseJson(raw));
    if (!parsed.success) {
      throw new Error(`Invalid ResourceProperty in JSON. ${zodParseErrorMessage(parsed.error)}`);
    }
    const { name, value } = parsed.data;
    return new ResourceProperty(name, value);
  }

  fromJSON(raw: string | unknown): Serializable {
    return ResourceProperty.fromJSON(raw);
  }

  validate(): void {
    const r = resourcePropertyJsonSchema.safeParse({ name: this.name, value: this.value });
    if (!r.success) {
      throw new Error(r.error.issues[0]?.message ?? 'Invalid ResourceProperty.');
    }
  }
}

/** The `[type ...]` line for a single resource section. */
export class ResourceHeader implements Serializable {
  type: ResourceType;
  modifiers: ResourceTypeModifier[];

  constructor(type: ResourceType, modifiers: ResourceTypeModifier[]) {
    this.type = type;
    this.modifiers = modifiers;
    this.validate();
  }

  static fromJSON(raw: string | unknown): ResourceHeader {
    const parsed = resourceHeaderJsonSchema.safeParse(parseJson(raw));
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

  validate(): void {
    const r = resourceHeaderJsonSchema.safeParse({
      type: this.type,
      modifiers: this.modifiers.map((m) => ({ name: m.name, value: m.value })),
    });
    if (!r.success) {
      throw new Error(r.error.issues[0]?.message ?? 'Invalid ResourceHeader.');
    }
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
    const parsed = resourceJsonSchema.safeParse(parseJson(raw));
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

  validate(): void {
    this.header.validate();
    this.properties.forEach((property) => property.validate());
  }
}

/** Whole `.tres` document: leading `gd_resource` header plus ordered resource blocks. */
export class ResourceFile implements Serializable {
  header: ResourceHeader;
  resources: Resource[];

  constructor(header: ResourceHeader, resources: Resource[], options?: { skipValidation?: boolean }) {
    this.header = header;
    this.resources = resources;
    if (!options?.skipValidation) {
      this.validate();
    }
  }

  /**
   * Assemble a file parsed from `.tres` text without {@link ResourceFile.validate}.
   * Validate separately (e.g. CLI analyzer) before relying on document invariants.
   */
  static fromParsedTres(header: ResourceHeader, resources: Resource[]): ResourceFile {
    return new ResourceFile(header, resources, { skipValidation: true });
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
    const hr = resourceHeaderJsonSchema.safeParse(header);
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
      const rr = resourceJsonSchema.safeParse(r);
      if (!rr.success) {
        errors.push(`resources[${i}]: ${zodParseErrorMessage(rr.error)}`);
      } else {
        resList.push(resourceFromParsed(rr.data));
      }
    });

    if (errors.length > 0) {
      return { errors };
    }

    const val = ResourceFile.collectValidationErrors(rh!, resList);
    if (val.length > 0) {
      return { errors: val };
    }

    return { file: new ResourceFile(rh!, resList), errors: [] };
  }

  fromJSON(raw: string | unknown): Serializable {
    return ResourceFile.fromJSON(raw);
  }

  insertResource(res: Resource): void {
    this.resources.push(res);
    this.validate();
  }

  toJSON(minified: boolean = false): string {
    return JSON.stringify(
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

  validate(): void {
    const errors = ResourceFile.collectValidationErrors(this.header, this.resources);
    if (errors.length > 0) {
      throw new Error(errors[0]);
    }
  }
}
