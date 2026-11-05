/** Output loss must never interrupt native cleanup. Journals are the durable evidence. */
export function journalSafeEmitter(output = process.stdout) {
  output.on('error', () => {});
  return (event, details = {}) => {
    try {
      output.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...details })}\n`);
    } catch {
      // A closed output stream does not change qualification or restoration state.
    }
  };
}

/** The parent handles Ctrl-C cooperatively; an in-flight native worker must finish cleanup. */
export function retainNativeWorkerOnInterrupt() {
  process.on('SIGINT', () => {});
}
