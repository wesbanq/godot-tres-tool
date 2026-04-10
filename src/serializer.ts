import * as analyzer from './analyzer';
import {
  coreValidationMessages,
  createIssue,
  ErrorCode,
  IssueSeverity,
  type Issue,
} from './errors';
import { ParseAggregateError, parseResourceContent } from './parser';
import {
  Resource,
  ResourceFile,
  ResourceHeader,
  ResourceProperty,
  ResourceTypeModifier,
  type PropertyArray,
  type PropertyValue,
  type Serializable,
} from './tres-types';

export type { Issue } from './errors';

/**
 * Options for `.tres` serialization. Omitted fields use {@link defaultSerializerConfig}.
 */
export type SerializerConfig = {
  /**
   * When true (default), serializing a {@link ResourceFile} runs {@link analyzer.analyzeResourceFile}
   * and returns failure if any error-level issues are reported.
   */
  verifyBeforeSerialize?: boolean;
};

/** Default options merged with any partial {@link SerializerConfig} you pass in. */
export const defaultSerializerConfig: SerializerConfig = {
  verifyBeforeSerialize: true,
};

export type SerializerSuccess<T> = { ok: true; value: T };
export type SerializerFailure = { ok: false; issues: Issue[] };
export type SerializerResult<T> = SerializerSuccess<T> | SerializerFailure;

function mergeSerializerConfig(config?: SerializerConfig): { verifyBeforeSerialize: boolean } {
  return {
    verifyBeforeSerialize:
      config?.verifyBeforeSerialize ?? defaultSerializerConfig.verifyBeforeSerialize!,
  };
}

function success<T>(value: T): SerializerResult<T> {
  return { ok: true, value };
}

function failure<T>(issues: Issue[]): SerializerResult<T> {
  return { ok: false, issues };
}

function issuesFromJsonDeserializeErrors(errors: string[]): Issue[] {
  return errors.map((msg) => {
    if (msg === coreValidationMessages.noResourcesInFile) {
      return createIssue(ErrorCode.NoResourcesInFile);
    }
    if (msg === coreValidationMessages.baseMissingFormatModifier) {
      return createIssue(ErrorCode.BaseMissingFormatModifier);
    }
    return createIssue(ErrorCode.SchemaValidationFailed, msg);
  });
}

function serializeResourceFileUnchecked(file: ResourceFile): string {
  return (
    serializeResourceHeader(file.header) +
    '\n\n' +
    file.resources.map((resource) => serializeResource(resource)).join('\n\n') +
    '\n'
  );
}

/** Godot writes integer `format` without quotes in .tres headers. */
function formatGodotHeaderModifier(name: string, value: string): string {
  if (Number.isFinite(Number(value))) {
    return `${name}=${value}`;
  }
  return `${name}="${value}"`;
}

function isPropertyArray(value: PropertyValue): value is PropertyArray {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'items' in value &&
    Array.isArray((value as PropertyArray).items)
  );
}

/**
 * Serialize a {@link PropertyValue} to the RHS of a Godot `name = value` line.
 */
export function serializePropertyValue(value: PropertyValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot serialize non-finite number in property value.');
    }
    return String(value);
  }
  if (isPropertyArray(value)) {
    const typePart = serializePropertyValue(value.type);
    const elems = value.items.map(serializePropertyValue).join(', ');
    return `Array[${typePart}]([${elems}])`;
  }
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  throw new Error(`Unsupported property value type: ${typeof value}`);
}

export function serializeResourceTypeModifier(mod: ResourceTypeModifier): string {
  return formatGodotHeaderModifier(mod.name, mod.value);
}

export function serializeResourceProperty(prop: ResourceProperty): string {
  return `${prop.name} = ${serializePropertyValue(prop.value)}`;
}

export function serializeResourceHeader(header: ResourceHeader): string {
  if (header.modifiers.length === 0) {
    return `[${header.type}]`;
  }
  const inner = header.modifiers.map((m) => formatGodotHeaderModifier(m.name, m.value)).join(' ');
  return `[${header.type} ${inner}]`;
}

export function serializeResource(resource: Resource): string {
  return (
    serializeResourceHeader(resource.header) +
    (resource.properties.length > 0 ? '\n' : '') +
    resource.properties.map((property) => serializeResourceProperty(property)).join('\n')
  );
}

export function serializeResourceFile(
  file: ResourceFile,
  config?: SerializerConfig
): SerializerResult<string> {
  const cfg = mergeSerializerConfig(config);
  if (cfg.verifyBeforeSerialize) {
    const issues = analyzer.analyzeResourceFile(file);
    const errors = issues.filter((i) => i.severity === IssueSeverity.Error);
    if (errors.length > 0) {
      return failure(errors);
    }
  }
  try {
    return success(serializeResourceFileUnchecked(file));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return failure([createIssue(ErrorCode.SchemaValidationFailed, msg)]);
  }
}

function serializeToTresUnchecked(obj: Serializable): string {
  if (obj instanceof ResourceFile) {
    return serializeResourceFileUnchecked(obj);
  }
  if (obj instanceof Resource) {
    return serializeResource(obj);
  }
  if (obj instanceof ResourceHeader) {
    return serializeResourceHeader(obj);
  }
  if (obj instanceof ResourceProperty) {
    return serializeResourceProperty(obj);
  }
  if (obj instanceof ResourceTypeModifier) {
    return serializeResourceTypeModifier(obj);
  }
  throw new Error('serializeToTres: unsupported Serializable type');
}

/**
 * Serialize a {@link Serializable} model to Godot `.tres` text.
 * For a {@link ResourceFile}, honors {@link SerializerConfig.verifyBeforeSerialize}.
 */
export function serializeToTres(
  obj: Serializable,
  config?: SerializerConfig
): SerializerResult<string> {
  if (obj instanceof ResourceFile) {
    return serializeResourceFile(obj, config);
  }
  try {
    return success(serializeToTresUnchecked(obj));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return failure([createIssue(ErrorCode.SchemaValidationFailed, msg)]);
  }
}

/** Parse UTF-8 `.tres` document text into a {@link ResourceFile}. */
export function deserializeResourceFileFromTres(content: string): SerializerResult<ResourceFile> {
  try {
    return success(parseResourceContent(content));
  } catch (e) {
    if (e instanceof ParseAggregateError) {
      return failure(issuesFromJsonDeserializeErrors(e.errors));
    }
    const msg = e instanceof Error ? e.message : String(e);
    return failure([createIssue(ErrorCode.SchemaValidationFailed, msg)]);
  }
}

/** Build a {@link ResourceFile} from JSON produced by {@link ResourceFile.toJSON} (string or parsed object). */
export function deserializeResourceFileFromJson(raw: string | unknown): SerializerResult<ResourceFile> {
  const { errors, file } = ResourceFile.fromJSONWithErrors(raw);
  if (errors.length > 0) {
    return failure(issuesFromJsonDeserializeErrors(errors));
  }
  return success(file!);
}
