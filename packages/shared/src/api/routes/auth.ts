import {
  AuthNotConfigured,
  InvalidCredentials,
  MissingCredentials,
} from "@shared/api/errors";
import { Authorization } from "@shared/api/middlewares/authorization";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

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
    HttpApiEndpoint.post("login", "/login", {
      payload: LoginRequest,
      success: LoginResponse,
      error: [MissingCredentials, InvalidCredentials, AuthNotConfigured],
    })
  )
  .add(
    HttpApiEndpoint.post("logout", "/logout", {
      success: LogoutResponse,
    })
  )
  .add(
    HttpApiEndpoint.get("me", "/me", {
      success: MeResponse,
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("status", "/status", {
      success: StatusResponse,
    })
  );
