import MoveableModule from 'react-moveable';

// react-moveable ships CommonJS-style typings: under NodeNext the default import is typed as the module object
// while bundlers and the ESM build hand over the component itself. Normalize both views.
type MoveableComponent = typeof MoveableModule.default;

export const Moveable: MoveableComponent = ((MoveableModule as unknown as { default?: unknown }).default ??
  MoveableModule) as MoveableComponent;

export type MoveableInstance = InstanceType<MoveableComponent>;
