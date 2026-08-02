import { z } from "zod";
export { toolDescriptions, toolNames, toolSummaries } from "./ai-instructions";

export const locationIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("SmartThings location ID returned by listLocations.");

export const optionalLocationIdSchema = locationIdSchema
  .optional()
  .describe("Optional SmartThings location ID used to filter devices.");

export const deviceListCursorSchema = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .optional()
  .describe("Optional nextCursor from a previous GPT Actions listDevices result.");

export const ruleIdSchema = z
  .string()
  .trim()
  .min(1)
  .describe("SmartThings Rule ID shown to the user.");

export const ruleJsonSchema = z
  .object({
    name: z.string().trim().min(1).describe("SmartThings Rule name."),
    actions: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .describe("SmartThings Rules actions array.")
  })
  .catchall(z.unknown());

export const targetRuleStatusSchema = z
  .enum(["Enabled", "Disabled"])
  .describe("Target SmartThings Rule status.");

export const ruleJsonReferenceCheckSchema = z.object({
  locationId: locationIdSchema,
  ruleJson: ruleJsonSchema.describe(
    "SmartThings Rule JSON drafted before calling this reference check."
  )
});

export const createRuleConfirmedSchema = ruleJsonReferenceCheckSchema.extend({
  ruleJson: ruleJsonSchema.describe(
    "Final SmartThings Rule JSON shown to the user in chat."
  )
});

export const updateRuleConfirmedSchema = z.object({
  locationId: locationIdSchema,
  ruleId: ruleIdSchema,
  ruleJson: ruleJsonSchema.describe(
    "Final full SmartThings RuleRequest JSON shown to the user in chat. Include name/actions and optional sequence/timeZoneId; omit read-only response fields."
  )
});

export const deleteRuleConfirmedSchema = z.object({
  locationId: locationIdSchema,
  ruleId: ruleIdSchema
});

export const setRuleStatusConfirmedSchema = z.object({
  locationId: locationIdSchema,
  ruleId: ruleIdSchema,
  targetStatus: targetRuleStatusSchema
});
