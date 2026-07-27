import { Toast as UiToast } from "@foldkit/ui";
import { Schema as S } from "effect";

export const ToastPayload = S.Struct({
  title: S.String,
  description: S.String,
});

export const Toast = UiToast.make(ToastPayload);
export const ToastTest = UiToast.test;
