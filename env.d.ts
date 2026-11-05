declare const __BUSY_ADDR__: string;
type BusyInputEvent = {
  key: 'encoder' | 'start' | 'ok' | 'back';
  action: 'clockwise' | 'counterclockwise' | 'press' | 'release' | 'short' | 'long' | 'repeat';
  delta?: number;
};
declare function listen(type: 'input', handler: (event: BusyInputEvent) => void): () => void;
