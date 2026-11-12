export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "You do not have access to this resource") => new HttpError(403, "forbidden", msg);
export const conflict = (msg: string) => new HttpError(409, "conflict", msg);

export function slugify(input: string): string {
  return input.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "")
    .trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "item";
}

export const currentPeriod = (d = new Date()) => d.toISOString().slice(0, 7);
