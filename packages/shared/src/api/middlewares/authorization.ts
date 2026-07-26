import { Context, Schema } from "effect";
import { HttpApiMiddleware } from "effect/unstable/httpapi";

export interface AuthenticatedUserValue {
  readonly username: string;
  readonly iat: number;
  readonly exp: number;
}

export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

export class AuthenticatedUser extends Context.Service<
  AuthenticatedUser,
  AuthenticatedUserValue
>()("AuthenticatedUser") {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: AuthenticatedUser }
>()("Http/Authorization", { error: Unauthorized }) {}
