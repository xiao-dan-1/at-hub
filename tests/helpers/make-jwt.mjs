import { Buffer } from "node:buffer";

export function makeJwt(header, payload, signature = "synthetic-signature") {
  const encode = value => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return [encode(header), encode(payload), signature].join(".");
}
