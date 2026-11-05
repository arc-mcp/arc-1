import { isAbsolute } from 'node:path';
import { HarnessError } from './safe-io.mjs';

export const configuration = {
  root: process.env.ARC1_QUALIFICATION_STATE_DIR,
  target: 'PR1142/001',
  actors: [
    {
      label: 'writerA',
      email: process.env.ARC1_TEST_PRIMARY_EMAIL,
      sapUser: process.env.ARC1_TEST_PRIMARY_SAP_USER,
      letter: 'A',
      write: true,
    },
    {
      label: 'writerB',
      email: process.env.ARC1_TEST_SECONDARY_EMAIL,
      sapUser: process.env.ARC1_TEST_SECONDARY_SAP_USER,
      letter: 'B',
      write: true,
    },
    {
      label: 'readerA',
      email: process.env.ARC1_TEST_PRIMARY_EMAIL,
      sapUser: process.env.ARC1_TEST_PRIMARY_SAP_USER,
      letter: 'A',
      write: false,
    },
  ],
};

export function validateConfiguration(config) {
  if (typeof config.root !== 'string' || !isAbsolute(config.root) || config.target !== 'PR1142/001')
    throw new HarnessError('INVALID_QUALIFICATION_CONFIGURATION');
  if (config.actors.length !== 3) throw new HarnessError('THREE_ACTORS_REQUIRED');
  for (const [index, actor] of config.actors.entries()) {
    if (
      actor.label !== ['writerA', 'writerB', 'readerA'][index] ||
      actor.write !== index < 2 ||
      typeof actor.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+$/.test(actor.email) ||
      typeof actor.sapUser !== 'string' ||
      !/^[A-Z0-9_]{1,12}$/.test(actor.sapUser)
    )
      throw new HarnessError('INVALID_EXPECTED_IDENTITY');
  }
  if (
    config.actors[0].email === config.actors[1].email ||
    config.actors[0].sapUser === config.actors[1].sapUser ||
    config.actors[2].email !== config.actors[0].email ||
    config.actors[2].sapUser !== config.actors[0].sapUser
  )
    throw new HarnessError('DISTINCT_WRITERS_REQUIRED');
}
