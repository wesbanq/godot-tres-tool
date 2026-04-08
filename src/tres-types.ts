export type ResourceType = 'resource' | 'sub_resource' | 'ext_resource' | 'gd_resource';
export type ResourceUid = `uid://${string}`;
export type ResourceId = `id://${string}`;
export type ResourceRes = `res://${string}`;
export type ResourcePath = `${string}/${string}`;
export type ResourcePropertyString = `${ResourcePath} = ${any}`;
export type ResourceTypeModifierString = `${string}="${string}"`;

export type ResourceTypeModifier = {
  name: string;
  value: string;
}

interface TresSerializable {
  validate(): void;
  toTres(): string;
}

export class ResourceProperty implements TresSerializable {
  name: string;
  value: any;

  constructor(name: string, value: any) {
    this.name = name;
    this.value = value;
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

export class ResourceHeader implements TresSerializable {
  type: ResourceType;
  modifiers: ResourceTypeModifier[];

  constructor(type: ResourceType, modifiers: ResourceTypeModifier[]) {
    this.type = type;
    this.modifiers = modifiers;
  }

  validate(): void {
    if (this.type.length === 0) {
      throw new Error("Resource header type is empty.");
    }
    if (this.modifiers.length === 0) {
      throw new Error("Resource header has no modifiers.");
    }
  }

  toTres(): string {
    this.validate();
    return "[" + this.type + " " + this.modifiers.map((modifier) => `${modifier.name}="${modifier.value}"`).join(' ') + "]";
  }
}

export class Resource implements TresSerializable {
  header: ResourceHeader;
  properties: ResourceProperty[];

  constructor(header: ResourceHeader, properties: ResourceProperty[]) {
    this.header = header;
    this.properties = properties;
  }

  validate(): void {
    this.header.validate();
    this.properties.forEach((property) => property.validate());
  }

  toTres(): string {
    return this.header.toTres() + "\n" + this.properties.map((property) => property.toTres()).join("\n");
  }
}

export class ResourceFile {
  header: ResourceHeader;
  resources: Resource[];

  constructor(header: ResourceHeader, resources: Resource[]) {
    this.header = header;
    this.resources = resources;
  }

  toJSON(): string {
    this.validate();
    return JSON.stringify(this, null, 2);
  }

  toTres(): string {
    this.validate();
    return this.header.toTres() + "\n" + this.resources.map((resource) => resource.toTres()).join("\n");
  }

  godotVersion(): string {
    const version = this.header.modifiers.find((modifier) => modifier.name === 'format');
    if (version) {
      return version.value;
    } else {
      throw new Error('Base resource header has no format modifier.');
    }
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