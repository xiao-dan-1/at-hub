import { build } from "vite";

for (const page of ["index", "subscription"]) {
  process.env.AT_INSPECTOR_PAGE = page;
  await build();
}
