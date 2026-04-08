export type ResourceType = 'resource' | 'sub_resource' | 'ext_resource' | 'gd_resource';
export type ResourceUid = `uid://${string}`;
export type ResourceId = `id://${string}`;
export type ResourceRes = `res://${string}`;
export type ResourcePath = `${string}/${string}`;
export type ResourcePropertyString = `${ResourcePath} = ${any}`;
export type ResourceTypeModifierString = `${string}="${string}"`;

  //TODO
export interface TresSerializable {
  validate(): void;
  toTres(): string;
  //toJSON(): string;
}

export class ResourceTypeModifier implements TresSerializable {
  name: string;
  value: string;

  constructor(name: string, value: string) {
    this.name = name;
    this.value = value;
    this.validate();
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
    this.validate();
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

export class Resource implements TresSerializable {
  header: ResourceHeader;
  properties: ResourceProperty[];

  constructor(header: ResourceHeader, properties: ResourceProperty[]) {
    this.header = header;
    this.properties = properties;
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

export class ResourceFile {
  header: ResourceHeader;
  resources: Resource[];

  constructor(header: ResourceHeader, resources: Resource[]) {
    this.header = header;
    this.resources = resources;
    this.validate();
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