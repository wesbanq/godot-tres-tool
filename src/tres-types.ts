export type ResourceType = 'resource' | 'sub_resource' | 'ext_resource' | 'gd_resource';
export type ResourceUid = `uid://${string}`;
export type ResourceId = `id://${string}`;
export type ResourceRes = `res://${string}`;

export interface Serializable {
  validate(): void;
  toTres(): string;
  /** Instance hook delegates to \`static fromJSON\` on each implementation class. */
  fromJSON(raw: string | unknown): Serializable;
}

export class ResourceTypeModifier implements Serializable {
  name: string;
  value: string;

  constructor(name: string, value: string) {
    this.name = name;
    this.value = value;
    this.validate();
  }

  static fromJSON(raw: string | unknown): ResourceTypeModifier {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (o === null || typeof o !== 'object' || !('name' in o) || !('value' in o)) {
      throw new Error('Invalid ResourceTypeModifier in JSON.');
    }
    const { name, value } = o as { name: unknown; value: unknown };
    if (typeof name !== 'string' || typeof value !== 'string') {
      throw new Error('Invalid ResourceTypeModifier in JSON.');
    }
    return new ResourceTypeModifier(name, value);
  }

  fromJSON(raw: string | unknown): Serializable {
    return ResourceTypeModifier.fromJSON(raw);
  }

  validate(): void {
    if (this.name.length === 0) {
      throw new Error("Resource type modifier name is empty.");
    }
    if (this.value.length === 0) {
      throw new Error("Resource type modifier value is empty.");
    }
  }

  toTres(): string {
    return `${this.name}="${this.value}"`;
  }
}

export class ResourceProperty implements Serializable {
  name: string;
  value: any;

  constructor(name: string, value: any) {
    this.name = name;
    this.value = value;
  }

  static fromJSON(raw: string | unknown): ResourceProperty {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (o === null || typeof o !== 'object' || !('name' in o) || !('value' in o)) {
      throw new Error('Invalid ResourceProperty in JSON.');
    }
    const { name, value } = o as { name: unknown; value: unknown };
    if (typeof name !== 'string') {
      throw new Error('Invalid ResourceProperty in JSON.');
    }
    return new ResourceProperty(name, value);
  }

  fromJSON(raw: string | unknown): Serializable {
    return ResourceProperty.fromJSON(raw);
  }

  validate(): void {
    if (this.name.length === 0) {
      throw new Error("Resource property name is empty.");
    }
    if (this.value === undefined) {
      throw new Error("Resource property value is undefined.");
    }
  }

  toTres(): string {
    this.validate();
    return `${this.name} = ${this.value}`;
  }
}

export class ResourceHeader implements Serializable {
  type: ResourceType;
  modifiers: ResourceTypeModifier[];

  constructor(type: ResourceType, modifiers: ResourceTypeModifier[]) {
    this.type = type;
    this.modifiers = modifiers;
    this.validate();
  }

  static fromJSON(raw: string | unknown): ResourceHeader {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (o === null || typeof o !== 'object' || !('type' in o) || !('modifiers' in o)) {
      throw new Error('Invalid ResourceHeader in JSON.');
    }
    const { type, modifiers } = o as { type: unknown; modifiers: unknown };
    if (typeof type !== 'string') {
      throw new Error('Invalid ResourceHeader in JSON.');
    }
    if (!Array.isArray(modifiers)) {
      throw new Error('Invalid ResourceHeader in JSON.');
    }
    return new ResourceHeader(
      type as ResourceType,
      modifiers.map((m) => ResourceTypeModifier.fromJSON(m))
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
    if (this.type.length === 0) {
      throw new Error("Resource header type is empty.");
    }
  }

  toTres(): string {
    return "[" + this.type + " " + this.modifiers.map((modifier) => `${modifier.name}="${modifier.value}"`).join(' ') + "]";
  }
}

export class Resource implements Serializable {
  header: ResourceHeader;
  properties: ResourceProperty[];

  constructor(header: ResourceHeader, properties: ResourceProperty[]) {
    this.header = header;
    this.properties = properties;
  }

  static fromJSON(raw: string | unknown): Resource {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (o === null || typeof o !== 'object' || !('header' in o) || !('properties' in o)) {
      throw new Error('Invalid Resource in JSON.');
    }
    const { header, properties } = o as { header: unknown; properties: unknown };
    if (!Array.isArray(properties)) {
      throw new Error('Invalid Resource in JSON.');
    }
    return new Resource(
      ResourceHeader.fromJSON(header),
      properties.map((p) => ResourceProperty.fromJSON(p))
    );
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

  toTres(): string {
    return this.header.toTres() + "\n" + this.properties.map((property) => property.toTres()).join("\n");
  }
}

export class ResourceFile implements Serializable {
  header: ResourceHeader;
  resources: Resource[];

  constructor(header: ResourceHeader, resources: Resource[]) {
    this.header = header;
    this.resources = resources;
    this.validate();
  }

  /**
   * Builds a ResourceFile from JSON produced by {@link ResourceFile.toJSON} (string or parsed object).
   */
  static fromJSON(raw: string | unknown): ResourceFile {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (data === null || typeof data !== 'object' || !('header' in data) || !('resources' in data)) {
      throw new Error('Invalid ResourceFile JSON: expected object with header and resources.');
    }
    const { header, resources } = data as { header: unknown; resources: unknown };
    if (!Array.isArray(resources)) {
      throw new Error('Invalid ResourceFile JSON: resources must be an array.');
    }
    return new ResourceFile(
      ResourceHeader.fromJSON(header),
      resources.map((r) => Resource.fromJSON(r))
    );
  }

  fromJSON(raw: string | unknown): Serializable {
    return ResourceFile.fromJSON(raw);
  }

  insertResource(res: Resource): void {
    this.resources.push(res);
    this.validate();
  }

  toJSON(): string {
    return JSON.stringify({
      header: this.header,
      resources: this.resources,
    }, null, 2);
  }

  toTres(): string {
    return this.header.toTres() + "\n" + this.resources.map((resource) => resource.toTres()).join("\n");
  }

  godotVersion(): string {
    return this.header.getModifier('format')!.value;
  }

  validate(): void {
    if (this.resources.length === 0) {
      throw new Error("No resources found in file.");
    }
    if (this.header.type !== 'gd_resource') {
      throw new Error("Base header is not a gd_resource.");
    }
    if (this.resources.slice(1).some((res) => res.header.type === 'gd_resource')) {
      throw new Error("Multiple gd_resource headers found in file.");
    }
    if (this.header.modifiers.find((modifier) => modifier.name === 'format') === undefined) {
      throw new Error("Base resource header has no format modifier.");
    }
  }
}
