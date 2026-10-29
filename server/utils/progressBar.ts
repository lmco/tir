import type { ProgressMessage } from "~/types/progress";

export type ProgressStreamer = {
  status: (value: string) => void;
  progress: (value: number) => void;
  saved: (value: number) => void;
  error: (value: string) => void | Promise<void>;
  complete: (value?: string, failed?: number) => void;
  raw: (msg: ProgressMessage) => void;
  finish: () => void;
};

export function createProgressStreamer(res: any): ProgressStreamer {
  const config = useRuntimeConfig();
  let ended = false;

  const write = (msg: ProgressMessage) => {
    if (ended || res.writableEnded) {
      logger.error({
        service: "ProgressStreamer",
        message: "Attempted to write after response ended.",
      });
      return;
    }

    const json = JSON.stringify(msg) + "\n";

    if (config.tir_debug) {
      logger.debug({ service: "ProgressStreamer", message: `Streaming: ${json.trim()}` });
    }

    res.write(json);
  };

  const finish = () => {
    if (!ended && !res.writeableEnded) {
      ended = true;
      try {
        res.end();
      } catch {}
    }
  };

  return {
    status: (value: string) => write({ type: "status", value }),
    progress: (value: number) => write({ type: "progress", value }),
    saved: (value: number) => write({ type: "saved", value }),
    error: (value: string) => write({ type: "error", value }),
    complete: (value?: string, failed?: number) => write({ type: "complete", value, failed }),
    raw: write,
    finish,
  };
}
