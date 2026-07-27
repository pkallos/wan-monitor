import { Option, Schema as S } from "effect";
import { ts } from "foldkit/schema";
import * as Dashboard from "@/dashboard";

export const Session = S.Struct({
  token: S.String,
  username: S.String,
});
export type Session = typeof Session.Type;

export const Checking = ts("Checking", {
  maybeToken: S.Option(S.String),
});
export type Checking = typeof Checking.Type;

export const LoggedOut = ts("LoggedOut", {
  username: S.String,
  password: S.String,
  isSubmitting: S.Boolean,
  maybeError: S.Option(S.String),
});
export type LoggedOut = typeof LoggedOut.Type;

export const LoggedIn = ts("LoggedIn", {
  maybeSession: S.Option(Session),
  dashboard: Dashboard.Model,
});
export type LoggedIn = typeof LoggedIn.Type;

export const Model = S.Union([Checking, LoggedOut, LoggedIn]);
export type Model = typeof Model.Type;

export const initLoggedOut = (
  maybeError: Option.Option<string> = Option.none()
): LoggedOut =>
  LoggedOut({
    username: "",
    password: "",
    isSubmitting: false,
    maybeError,
  });
