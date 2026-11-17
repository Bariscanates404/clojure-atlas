import { implementations } from "./implementations.js";
import { multimethods } from "./multimethods.js";
import { reFrame } from "./reframe.js";
import { httpRoutes } from "./routes.js";
import { dataAttributes } from "./data.js";
import { systemKeys } from "./system.js";
import { schemas } from "./schema.js";
import { keyTables, mapKeys } from "./keys.js";
import { clientRoutes } from "./client-routes.js";
import { requests } from "./requests.js";
import { browserTests, selectors } from "./playwright.js";
export const ADAPTERS = [multimethods, implementations, reFrame, httpRoutes, dataAttributes, systemKeys, schemas, mapKeys, keyTables,
    clientRoutes, requests, selectors, browserTests];
