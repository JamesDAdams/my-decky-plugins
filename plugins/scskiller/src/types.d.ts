declare module "@decky/manifest" {
  const manifest: {
    name: string;
    author: string;
    flags: string[];
    api_version: number;
    [key: string]: unknown;
  };
  export default manifest;
}
