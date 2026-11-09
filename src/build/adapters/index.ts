// Every adapter, in the order their rows are merged. Each switches itself on from the code it sees.
import type { Adapter } from '../model.ts';
import { multimethods } from './multimethods.ts';
import { reFrame } from './reframe.ts';
import { httpRoutes } from './routes.ts';
import { dataAttributes } from './data.ts';
import { systemKeys } from './system.ts';
import { schemas } from './schema.ts';

export const ADAPTERS: readonly Adapter[] = [multimethods, reFrame, httpRoutes, dataAttributes, systemKeys, schemas];
