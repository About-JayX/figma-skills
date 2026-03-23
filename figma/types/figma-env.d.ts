/// <reference types="@figma/plugin-typings" />

declare const __html__: string;

declare module "*.html" {
  const html: string;
  export default html;
}
