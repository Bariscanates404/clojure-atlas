// Every adapter, in the order their rows are merged. Each switches itself on from the code it sees.
import type { Adapter } from '../model.ts';
import { implementations } from './implementations.ts';
import { multimethods } from './multimethods.ts';
import { reFrame } from './reframe.ts';
import { httpRoutes } from './routes.ts';
import { dataAttributes } from './data.ts';
import { systemKeys } from './system.ts';
import { schemas } from './schema.ts';
import { keyTables, mapKeys } from './keys.ts';
import { clientRoutes } from './client-routes.ts';
import { requests } from './requests.ts';
import { browserTests, selectors } from './playwright.ts';

export const ADAPTERS: readonly Adapter[] = [multimethods, implementations, reFrame, httpRoutes, dataAttributes, systemKeys, schemas, mapKeys, keyTables, clientRoutes, requests, selectors, browserTests];
