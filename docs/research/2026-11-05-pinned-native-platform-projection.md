# Selected-target native platform projection

The final PP FLP window at `3adea700e80e6a31930e106c72fc058d16d5d0f5`
returned the public native-platform-evidence refusal before its FLP adapter ran.
The immutable incident diagnosis remains private; its report SHA256 is
`0eb538b8d0675ed26eb905bb3d667e12f235652bfbe76bb16f9c7eb669d47c3c`.
That diagnosis does not claim the actual component probe succeeded: the authorized
terminal receipts contain the MCP error, not that native response. The source
wiring independently explains why even a successful component response could not
satisfy the gate.

`buildMultiTargetConfig` deliberately sets an on-premise compatibility default,
and does not inherit the instance's configured ABAP release. Both automatic and
manual feature probes formerly passed that default as a platform override. Native
platform detection consequently became `systemTypeSource=config`, although the
public native-governed profiles require probed on-premise 758 evidence.

The probe producers now select native detection for an explicit target. Ordinary
single-target overrides keep their existing precedence. The runtime config,
per-target feature-flight coordination, authorization-limited PP cache rules and
strict public platform gate are unchanged.

A real HTTP/MCP composition regression exposed a second boundary after that fix:
FLP, native-governed publication and parentless local-package creation passed their
runtime config into the internal recording profile. That config correctly had no
release, so the profile still refused. Public dispatch now passes a separate frozen
coverage projection made only after the existing native on-premise 758 check.
All three internal wrappers retain their config-based default for bound private
qualification callers; no tool input, schema flag, configured-release inheritance
or client-provided authority was added. Package DELETE already received the
validated environment and needed no analogous bridge.

Tests exercise the real public HTTP/MCP router, runtime builder, selected-user
client, feature probes, cache, dispatch and native adapters. Only token verification,
Destination/Connectivity credentials and SAP wire responses are controlled. Both
direct and Connectivity paths cover automatic/manual probes and the three native
profiles. Negative controls preserve missing/denied/malformed/incompatible native
platform refusal despite a configured 758 release, target/grant and user isolation,
read-only/aggregate and request-policy denials, and rejection of caller-supplied
coverage. Existing private qualification and ordinary override tests remain relevant.

These are source and controlled-wire results, not fresh PP/native qualification.
The consumed FLP claim is not replayable. Any subsequent live window needs the
reviewed corrected artifact, matching source bindings and fresh prerequisites;
recording and cleanup retain their documented native-governed/unverified limits.
