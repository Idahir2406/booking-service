/**
 * Tiny pure state-machine helper (F1). A machine is just a map
 * `from -> allowed targets`. Same-state "transitions" are idempotent no-ops
 * (webhook replays), never errors.
 */
export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export const TRANSITION_RESULT = {
  CHANGED: "changed",
  NOOP: "noop",
} as const;

export type TransitionResult =
  (typeof TRANSITION_RESULT)[keyof typeof TRANSITION_RESULT];

export class InvalidTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string | null,
    readonly to: string,
  ) {
    super(`Invalid ${machine} transition: ${from ?? "∅"} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly initial: readonly S[];
  readonly transitions: TransitionMap<S>;
  canTransition: (from: S, to: S) => boolean;
  /** Throws InvalidTransitionError; returns NOOP when from === to. */
  assertTransition: (from: S, to: S) => TransitionResult;
  isTerminal: (state: S) => boolean;
  isState: (value: unknown) => value is S;
}

export function defineStateMachine<S extends string>(config: {
  name: string;
  states: readonly S[];
  initial: readonly S[];
  transitions: TransitionMap<S>;
}): StateMachine<S> {
  const { name, states, initial, transitions } = config;
  const canTransition = (from: S, to: S): boolean =>
    from === to || transitions[from].includes(to);

  return {
    name,
    states,
    initial,
    transitions,
    canTransition,
    assertTransition: (from, to) => {
      if (from === to) {
        return TRANSITION_RESULT.NOOP;
      }
      if (!transitions[from].includes(to)) {
        throw new InvalidTransitionError(name, from, to);
      }
      return TRANSITION_RESULT.CHANGED;
    },
    isTerminal: state => transitions[state].length === 0,
    isState: (value): value is S =>
      typeof value === "string" &&
      (states as readonly string[]).includes(value),
  };
}
