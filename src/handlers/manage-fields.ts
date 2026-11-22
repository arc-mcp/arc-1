import { z } from 'zod';
import { canonicalAdtObjectUri } from '../adt/path-safety.js';

export const MANAGE_OBJECT_URI_SCHEMA = z
  .string()
  .refine((value) => canonicalAdtObjectUri(value) !== null, 'objectUri must be a canonical host-relative ADT path');
