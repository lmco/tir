type Resolve = () => void;
type Reject = (e?: unknown) => void;

interface Signal {
  promise: Promise<void>;
  resolve: Resolve;
  reject: Reject;
  isResolved: boolean;
}

export const CONTROL_DATA_IMPORT_SIGNAL = 'control:data:import'

const signals = new Map<string, Signal>();

export function getSignalStatus(name: string): Signal {
  if (!signals.has(name)) {
    let resolveFn!: Resolve;
    let rejectFn!: Reject;

    const promise = new Promise<void>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const signal: Signal = {
      promise,
      resolve: function(this: Signal) {
        this.isResolved = true;
        resolveFn();
      },
      reject: function(this: Signal, e?: unknown) {
        this.isResolved = true;
        rejectFn(e);
      },
      isResolved: false
    };

    signals.set(name, signal);
  }
  return signals.get(name)!;
}

export function waitForSignal(name: string): Promise<void> {
  return getSignalStatus(name).promise;
}

export function signalReady(name: string): void {
  const signal = getSignalStatus(name);
  // console.log("Before resolve:", name, signal.isResolved);
  signal.resolve();
  // console.log("After resolve:", name, signal.isResolved);
}