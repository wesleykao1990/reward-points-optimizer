import { createVercelRequestHandler } from "../apps/consumer-alpha/dist/vercel-adapter.js";

export default createVercelRequestHandler({
  environment: process.env,
  requireDatabase: true,
});
