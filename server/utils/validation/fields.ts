import { z } from "zod";
import { H3String, H3OptionalString } from "./h3";

export const BoundaryIdSchema = H3String.transform(Number).pipe(z.number().int().positive());

export const BoundaryIdOptionalSchema = H3OptionalString.transform((s) =>
  s === undefined ? undefined : Number(s),
).pipe(z.number().int().positive().optional());
