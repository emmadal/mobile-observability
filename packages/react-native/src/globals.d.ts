// Metro inlines process.env.NODE_ENV; declared here because the SDK does not depend on @types/node.
declare const process: { env: { NODE_ENV?: string } };
