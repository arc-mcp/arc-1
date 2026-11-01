/** SAPDiagnose shared timeout/variant and package CI input definitions. Consumed by tools.ts and schemas.ts. */
import { z } from 'zod';
export const CI_PACKAGES_SCHEMA = z
  .array(
    z
      .string()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9_/$]+$/),
  )
  .max(50);
const packageItem = { type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_/$]+$' };
export const SAPDIAGNOSE_ADDITIONAL_INPUTS = {
  variant: {
    type: 'string',
    description: 'atc/atc_ci variant; atc_variants name filter (*=all)',
  },

  timeoutSeconds: {
    type: 'number',
    description: 'Timeout 1–3600s: unittest/atc default 300; CI overall default 600.',
  },

  packages: {
    type: 'array',
    maxItems: 50,
    items: packageItem,
    description: 'CI exact packages; 1–50 total with packageTrees.',
  },
  packageTrees: {
    type: 'array',
    maxItems: 50,
    items: packageItem,
    description: 'CI packages including subpackages.',
  },
  configuration: {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    description: 'atc_ci: optional configuration.',
  },
  failOnSeverity: {
    type: 'string',
    enum: ['error', 'warning', 'info'],
    description: 'atc_ci failure threshold (default error).',
  },
  includeReportXml: {
    type: 'boolean',
    description: 'CI XML reports (default false; 256 KiB total cap).',
  },
};
