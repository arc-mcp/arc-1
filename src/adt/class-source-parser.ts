/** Parse boundaries, not deployment-language eligibility; configured lint remains separate. */
import { Comment, Config, LanguageVersion, MemoryFile, type Nodes, Objects, Registry } from '@abaplint/core';
import { AdtSafetyError } from './errors.js';

const config = Config.getDefault(undefined, LanguageVersion.Normal);
export function parseClassSourceStatements(source: string): Nodes.StatementNode[] {
  if (/\r(?!\n)/.test(source)) throw new AdtSafetyError('Bare carriage returns are not supported; use LF or CRLF.');
  const registry = new Registry(config);
  registry.addFile(new MemoryFile('zboundary.prog.abap', source));
  registry.parse();
  const object = registry.getFirstObject();
  if (!(object instanceof Objects.Program)) throw new AdtSafetyError('Cannot parse the selected class source.');
  return (
    object
      .getMainABAPFile()
      ?.getStatements()
      .filter((statement) => !(statement.get() instanceof Comment)) ?? []
  );
}
