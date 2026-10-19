import { z } from "zod";

const publicHttpsUrl = z.string().trim().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Debe ser una URL HTTPS pública sin usuario ni contraseña");

export const catalogProductMutationSchema = z.object({
  retailerId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  availability: z.enum(["in stock", "out of stock", "preorder"]),
  condition: z.enum(["new", "refurbished", "used"]),
  price: z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, "Usa un precio numérico sin separadores de miles")
    .refine((value) => Number(value) > 0, "El precio debe ser mayor a cero"),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  brand: z.string().trim().max(100),
  imageUrls: z.array(publicHttpsUrl).min(1, "Agrega al menos una imagen").max(10, "WhatsApp permite hasta 10 imágenes por producto"),
  url: publicHttpsUrl,
  category: z.string().trim().max(200),
  material: z.string().trim().max(200),
  color: z.string().trim().max(100),
  size: z.string().trim().max(100),
  pattern: z.string().trim().max(100),
});
