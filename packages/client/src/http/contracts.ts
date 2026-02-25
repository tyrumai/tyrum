import { z } from "zod";
import { HttpTransport, validateOrThrow } from "./shared.js";

const ContractSchemaFilename = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^/\\]+\.json$/, "contract schema filename must be a .json basename")
  .refine((value) => !value.includes(".."), "contract schema filename cannot contain '..'")
  .refine((value) => value !== "catalog.json", "use getCatalog() for catalog.json");

const ContractCatalogSchema = z
  .object({
    format: z.string().trim().min(1).optional(),
    schemas: z
      .array(
        z
          .object({
            file: z.string().trim().min(1),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const JsonObjectSchema = z.record(z.string(), z.unknown());

export type ContractCatalog = z.infer<typeof ContractCatalogSchema>;
export type ContractJsonSchema = z.infer<typeof JsonObjectSchema>;

export interface ContractsApi {
  getCatalog(): Promise<ContractCatalog>;
  getSchema(file: string): Promise<ContractJsonSchema>;
}

export function createContractsApi(transport: HttpTransport): ContractsApi {
  return {
    async getCatalog() {
      return await transport.request({
        method: "GET",
        path: "/contracts/jsonschema/catalog.json",
        response: ContractCatalogSchema,
      });
    },

    async getSchema(file) {
      const parsedFile = validateOrThrow(ContractSchemaFilename, file, "contract schema filename");
      return await transport.request({
        method: "GET",
        path: `/contracts/jsonschema/${encodeURIComponent(parsedFile)}`,
        response: JsonObjectSchema,
      });
    },
  };
}
