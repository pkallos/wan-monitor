import { HttpApiMiddleware, HttpApiSchema } from "@effect/platform";
import { Context, Schema } from "effect";

export interface AuthenticatedUserValue {
  readonly username: string;
  readonly iat: number;
  readonly exp: number;
}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  HttpApiSchema.annotations({ status: 401 })
) {}

export class AuthenticatedUser extends Context.Tag("AuthenticatedUser")<
  AuthenticatedUser,
  AuthenticatedUserValue
>() {}

export class Authorization extends HttpApiMiddleware.Tag<Authorization>()(
  "Http/Authorization",
  {
    failure: Unauthorized,
    provides: AuthenticatedUser,
  }
) {}
