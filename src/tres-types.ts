export type ResourceType = 'resource' | 'sub_resource' | 'ext_resource' | 'gd_resource';
export type ResourceUid = `uid://${string}`;
export type ResourceId = `id://${string}`;
export type ResourcePath = `${string}/${string}`;
export type ResourcePropertyString = `${ResourcePath} = ${any}`;
export type ResourceTypeModifier = `${string}="${string}"`;

export class ResourceProperty {
  name: string;
  value: any;

  constructor(property: string) {
    const idx = property.indexOf(' = ');
    if (idx === -1) {
      this.name = property.trim();
      this.value = undefined;
    } else {
      this.name = property.slice(0, idx).trim();
      this.value = property.slice(idx + 3).trim();
    }
  }
}

export type ResourceHeader = {
  type: ResourceType;
  modifiers: ResourceTypeModifier[];
}

export type Resource = {
  header: ResourceHeader;
  properties: ResourceProperty[];
}

export type TresFile = {
  resources: Resource[];
}