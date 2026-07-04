import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import {
  AuthNotConfigured,
  InvalidCredentials,
  MissingCredentials,
} from "@shared/api/errors";
import { Authorization } from "@shared/api/middlewares/authorization";
import { Schema } from "effect";

const LoginRequest = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
});

const LoginResponse = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  username: Schema.String,
});

const LogoutResponse = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
});

const MeResponse = Schema.Struct({
  username: Schema.String,
  authenticated: Schema.Boolean,
});

const StatusResponse = Schema.Struct({
  authRequired: Schema.Boolean,
});

export const AuthApiGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("login", "/login")
      .setPayload(LoginRequest)
      .addSuccess(LoginResponse)
      .addError(MissingCredentials)
      .addError(InvalidCredentials)
      .addError(AuthNotConfigured)
  )
  .add(
    HttpApiEndpoint.post("logout", "/logout")
      .addSuccess(LogoutResponse)
      .addError(Schema.String)
  )
  .add(
    HttpApiEndpoint.get("me", "/me")
      .addSuccess(MeResponse)
      .addError(Schema.String, { status: 401 })
      .middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("status", "/status")
      .addSuccess(StatusResponse)
      .addError(Schema.String)
  );
