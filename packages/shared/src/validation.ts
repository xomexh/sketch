import { z } from "zod";

export const whatsappNumberSchema = z
  .string()
  .min(8, "Phone number must be at least 8 characters")
  .startsWith("+", "Phone number must start with +");

export const emailSchema = z.string().email("Invalid email address");
