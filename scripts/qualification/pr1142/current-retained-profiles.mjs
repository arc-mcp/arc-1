/** Compiled retained plans, never an operator-selected owner graph or resume offset. */
import {
  assertRetainedContext,
  assertRetainedObservation,
  readFixedRetainedHistory,
  retainedDescriptor,
  retainedMarker,
  retainedPlan,
  retainedRoot,
} from './current-retained-history.mjs';
import {
  assertTextTailContext,
  assertTextTailObservation,
  readFixedTextTailHistory,
  textTailDescriptor,
  textTailPlan,
  textTailRoot,
} from './current-text-tail-history.mjs';
import {
  assertTextTailV2BeforeDelete,
  assertTextTailV2Observation,
} from './current-text-tail-v2-context.mjs';
import {
  assertTextTailV2Context,
  readFixedTextTailV2History,
  textTailV2Descriptor,
  textTailV2Plan,
  textTailV2Root,
} from './current-text-tail-v2-history.mjs';
export const retainedProfile = Object.freeze({
  plan: retainedPlan,
  root: retainedRoot,
  descriptor: retainedDescriptor,
  marker: retainedMarker,
  count: 3,
  textOnly: false,
  readHistory: readFixedRetainedHistory,
  assertContext: assertRetainedContext,
  assertObservation: assertRetainedObservation,
});
export const textTailProfile = Object.freeze({
  plan: textTailPlan,
  root: textTailRoot,
  descriptor: textTailDescriptor,
  marker: retainedMarker,
  count: 4,
  textOnly: true,
  readHistory: readFixedTextTailHistory,
  assertContext: assertTextTailContext,
  assertObservation: assertTextTailObservation,
});
export const textTailV2Profile = Object.freeze({
  plan: textTailV2Plan,
  root: textTailV2Root,
  descriptor: textTailV2Descriptor,
  marker: retainedMarker,
  count: 4,
  textOnly: true,
  readHistory: readFixedTextTailV2History,
  assertContext: assertTextTailV2Context,
  assertObservation: assertTextTailV2Observation,
  beforeDelete: assertTextTailV2BeforeDelete,
  retainAbsence: true,
  currentJournalObservation: true,
});
export const retainedProfileForRoot = (root) =>
  [retainedProfile, textTailProfile, textTailV2Profile].find((p) => p.root === root);
