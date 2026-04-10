import * as parser from './parser';
import {
  Resource,
  ResourceFile,
  ResourceHeader,
  ResourceProperty,
  ResourceTypeModifier,
  type Serializable,
} from './tres-types';

/** Godot writes integer `format` without quotes in .tres headers. */
function formatGodotHeaderModifier(name: string, value: string): string {
  if (Number.isFinite(Number(value))) {
    return `${name}=${value}`;
  }
  return `${name}="${value}"`;
}

/** Match Godot property serialization (numbers and constructor/array literals unquoted; plain strings quoted). */
function formatGodotPropertyValue(value: string): string {
  if (/^-?\d+$/.test(value)) {
    return value;
  }
  if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(value)) {
    return value;
  }
  if (value === 'true' || value === 'false') {
    return value;
  }
  if (/^(ExtResource|SubResource)\s*\(/i.test(value)) {
    return value;
  }
  if (/^Array\[/.test(value)) {
    return value;
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function serializeResourceTypeModifier(mod: ResourceTypeModifier): string {
  return formatGodotHeaderModifier(mod.name, mod.value);
}

export function serializeResourceProperty(prop: ResourceProperty): string {
  prop.validate();
  return `${prop.name} = ${formatGodotPropertyValue(prop.value)}`;
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

export function serializeResourceFile(file: ResourceFile): string {
  return (
    serializeResourceHeader(file.header) +
    '\n\n' +
    file.resources.map((resource) => serializeResource(resource)).join('\n\n') +
    '\n'
  );
}

/**
 * Serialize a {@link Serializable} model to Godot `.tres` text.
 * Dispatches on concrete class; unknown shapes throw.
 */
export function serializeToTres(obj: Serializable): string {
  if (obj instanceof ResourceFile) {
    return serializeResourceFile(obj);
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

/** Parse UTF-8 `.tres` document text into a {@link ResourceFile}. */
export function deserializeResourceFileFromTres(content: string): ResourceFile {
  return parser.parseResourceContent(content);
}

/** Build a {@link ResourceFile} from JSON (string or object). Throws on first error. */
export function deserializeResourceFileFromJson(raw: string | unknown): ResourceFile {
  return ResourceFile.fromJSON(raw);
}

/** Like {@link deserializeResourceFileFromJson} but collects all validation errors. */
export function deserializeResourceFileFromJsonWithErrors(
  raw: string | unknown
): { errors: string[]; file?: ResourceFile } {
  return ResourceFile.fromJSONWithErrors(raw);
}
