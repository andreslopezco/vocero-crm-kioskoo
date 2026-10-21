import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { ensureWhatsAppDataset } from "@/lib/meta/capi";
import { MetaApiError } from "@/lib/meta/client";
import {
  atribucionDisabledResponse,
  atribucionEnabled,
} from "@/server/attribution/flag";
import {
  deleteCapiSettings,
  getCapiSettingsView,
  saveCapiSettings,
  stageBelongsToOrg,
} from "@/server/attribution/settings";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

/**
 * 016 — La conexión del negocio con su dataset de Meta.
 *
 * Sin la bandera `ATRIBUCION` esto no existe: 404, no 403 — no hay nada que
 * revelar sobre un endpoint que esta instancia no tiene.
 */

export const GET = withAuth(async (session) => {
  if (!atribucionEnabled()) return atribucionDisabledResponse();
  const capi = await getCapiSettingsView(session.organizationId);
  return Response.json({ capi });
});

const putSchema = z.object({
  datasetId: z.string().trim().min(1),
  /**
   * Omitirlo reusa el token del negocio que ya conectó WhatsApp: es el mismo
   * token que autoriza publicar en su dataset, y pedirlo otra vez solo
   * consigue que alguien pegue un secreto en un chat.
   */
  token: z.string().trim().min(1).optional(),
  /** La etapa que ESTE negocio considera "lead calificado"; null lo apaga. */
  qualifiedStageId: z.string().trim().min(1).nullish(),
});

export const PUT = withAuth(async (session, req: Request) => {
  if (!atribucionEnabled()) return atribucionDisabledResponse();

  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const credentials = await getCredentialsByOrg(session.organizationId);
  if (!credentials) {
    return apiError(
      409,
      "sin_whatsapp",
      "No hay conexión de WhatsApp para identificar su dataset"
    );
  }
  const token = body.data.token ?? credentials.token;

  let datasetId: string;
  try {
    datasetId = await ensureWhatsAppDataset({
      wabaId: credentials.wabaId,
      token,
    });
  } catch (err) {
    const detail =
      err instanceof MetaApiError
        ? err.diagnosticMessage
        : err instanceof Error
          ? err.message
          : String(err);
    return apiError(
      err instanceof MetaApiError && err.status >= 500 ? 502 : 422,
      "dataset_meta_invalido",
      `Meta no pudo obtener el dataset asociado a WhatsApp: ${detail}`
    );
  }

  const qualifiedStageId = body.data.qualifiedStageId ?? null;
  if (
    qualifiedStageId &&
    !(await stageBelongsToOrg(session.organizationId, qualifiedStageId))
  ) {
    return apiError(
      422,
      "etapa_invalida",
      "Esa etapa no es de este negocio"
    );
  }

  await saveCapiSettings({
    organizationId: session.organizationId,
    datasetId,
    token,
    qualifiedStageId,
  });
  return Response.json({ ok: true, datasetId });
});

export const DELETE = withAuth(async (session) => {
  if (!atribucionEnabled()) return atribucionDisabledResponse();
  await deleteCapiSettings(session.organizationId);
  return Response.json({ ok: true });
});
