import crypto from "crypto";

function md5Lower(str: string): string {
  return crypto.createHash("md5").update(str, "utf8").digest("hex").toLowerCase();
}

export function getChangduTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

function buildChangduPostParamsValue(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

function buildChangduSign(
  ts: number,
  paramsValue: string,
  distributorId: number,
  secretKey: string
): string {
  const raw = `${distributorId}${secretKey}${ts}${paramsValue}`;
  return md5Lower(raw);
}

export function buildChangduPostHeaders(
  body: Record<string, unknown>,
  ts: number | undefined,
  distributorId: number,
  secretKey: string
): {
  sign: string;
  ts: number;
  headers: { "header-sign": string; "header-ts": string };
} {
  const timestamp = ts ?? getChangduTimestamp();
  const paramsValue = buildChangduPostParamsValue(body);
  const sign = buildChangduSign(timestamp, paramsValue, distributorId, secretKey);

  return {
    sign,
    ts: timestamp,
    headers: {
      "header-sign": sign,
      "header-ts": String(timestamp),
    },
  };
}
