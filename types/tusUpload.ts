export type TusUploadHandle = {
  handle: (userId: number | null) => Promise<void>;
};

declare module "h3" {
  interface H3EventContext {
    tus?: TusUploadHandle;
  }
}
