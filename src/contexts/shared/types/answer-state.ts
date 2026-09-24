// "unanswered" != "no": an explicit "no" counts as completed for the profile (spec C12.5)
export const answer_state_values = ["unanswered", "no", "yes"] as const;
export type AnswerStateValue = (typeof answer_state_values)[number];
