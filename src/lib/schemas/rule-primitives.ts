import { z } from "zod";

export const StringOp = z.enum(["contains", "exact", "regex"]);
