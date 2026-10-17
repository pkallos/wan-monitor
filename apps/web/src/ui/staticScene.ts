import { Scene } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

/**
 * Test harness for stateless view helpers: renders `view` once with no model
 * or messages, then runs the given Scene assertions against it.
 */
export const renderStatic =
  (view: (h: HtmlBuilder<never>) => Html) =>
  (...steps: ReadonlyArray<Scene.SceneStep<null, never, undefined>>): void =>
    Scene.scene(
      {
        update: (model: null) => ({ model }),
        view: (_model: null, h: HtmlBuilder<never>) => view(h),
      },
      Scene.given(null),
      ...steps
    );
