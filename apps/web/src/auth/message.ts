import { Schema as S } from "effect";
import { m } from "foldkit/message";
import * as Dashboard from "@/dashboard";

export const SucceededFetchAuthStatus = m("SucceededFetchAuthStatus", {
  authRequired: S.Boolean,
});
export const FailedFetchAuthStatus = m("FailedFetchAuthStatus", {
  error: S.String,
});

export const SucceededFetchMe = m("SucceededFetchMe", {
  username: S.String,
});
export const FailedFetchMe = m("FailedFetchMe", {
  error: S.String,
});

export const ChangedUsername = m("ChangedUsername", { value: S.String });
export const ChangedPassword = m("ChangedPassword", { value: S.String });
export const SubmittedLogin = m("SubmittedLogin");
export const SucceededLogin = m("SucceededLogin", {
  token: S.String,
  username: S.String,
});
export const FailedLogin = m("FailedLogin", { error: S.String });

export const ClickedLogout = m("ClickedLogout");
export const CompletedLogout = m("CompletedLogout");

export const CompletedSaveSession = m("CompletedSaveSession");
export const FailedSaveSession = m("FailedSaveSession", { error: S.String });
export const CompletedClearSession = m("CompletedClearSession");
export const FailedClearSession = m("FailedClearSession", { error: S.String });

export const GotDashboardMessage = m("GotDashboardMessage", {
  message: Dashboard.Message,
});

export const Message = S.Union([
  SucceededFetchAuthStatus,
  FailedFetchAuthStatus,
  SucceededFetchMe,
  FailedFetchMe,
  ChangedUsername,
  ChangedPassword,
  SubmittedLogin,
  SucceededLogin,
  FailedLogin,
  ClickedLogout,
  CompletedLogout,
  CompletedSaveSession,
  FailedSaveSession,
  CompletedClearSession,
  FailedClearSession,
  GotDashboardMessage,
]);
export type Message = typeof Message.Type;
